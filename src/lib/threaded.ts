import 'reflect-metadata';
import _ from 'lodash';

import { cpus } from 'node:os';
import { isMainThread, Worker, parentPort, workerData, MessageChannel, threadId } from 'node:worker_threads';

import { AbstractPseudoTransfer } from './pseudo-transfer';
import { AbstractAsyncContext } from './async-context';
import { RPC_REFLECT } from '../civ-rpc/base';
import { AbstractRPCRegistry, RPCOptions } from '../civ-rpc/registry';
import { LoggerInterface } from './logger';
import { perNextTick } from '../decorators/per-tick';
import { marshalErrorLike } from '../utils/lang';
import { AsyncService } from './async-service';
import { Defer } from './defer';

export enum RUN_IN_THREAD {
    THIS_THREAD,
    CHILD_THREAD
}

export interface WorkerStatusReport {
    channel: string;
    event: 'reportOngoingTasks';
    ongoingTasks: number;
    openPorts: number;
}

export abstract class AbstractThreadedServiceRegistry extends AbstractRPCRegistry {

    protected abstract pseudoTransfer: AbstractPseudoTransfer;
    protected abstract asyncContext: AbstractAsyncContext;
    protected abstract logger: LoggerInterface;

    filesToLoad: Set<string> = new Set();
    workers = new Map<Worker, {
        ongoingTasks: number;
        openPorts: number;
    }>();

    workerEntrypoint = __filename;

    maxWorkers = cpus().length;

    ongoingTasks = 0;

    runInThread = isMainThread ? RUN_IN_THREAD.CHILD_THREAD : RUN_IN_THREAD.THIS_THREAD;

    constructor(..._args: any[]) {
        super(...arguments);

        if (!isMainThread) {
            process.nextTick(() => {
                if (this.__status === 'init') {
                    this.serviceReady();
                }
            });
        }
    }

    override async init() {
        const o = { stack: '' };
        Error.captureStackTrace(o, AbstractThreadedServiceRegistry.prototype.init);
        const l = o.stack.split('\n')[1];
        const m = l.match(/at .+ \((.+)\:\d+\:\d+\)/);
        const f = m?.[1]?.trim();

        this.workerEntrypoint = f ?? this.workerEntrypoint;

        this.initWorker();
    }

    loadInWorker(file: string) {
        this.filesToLoad.add(file);
    }

    createWorker() {
        this.logger.debug(`Starting new worker thread with ${this.filesToLoad.size} files to load ...`);
        const worker = new Worker(this.workerEntrypoint, {
            workerData: {
                type: this.constructor.name,
                filesToLoad: [...this.filesToLoad],
            }
        });

        this.workers.set(worker, {
            ongoingTasks: 0,
            openPorts: 0,
        });

        const handler = (msg: WorkerStatusReport) => {
            if (msg?.channel === this.constructor.name && msg?.event === 'reportOngoingTasks') {
                this.workers.set(worker, {
                    ongoingTasks: msg.ongoingTasks,
                    openPorts: msg.openPorts,
                });
            }
        };
        worker.on('message', handler);
        worker.on('error', (err) => {
            this.logger.error(`Worker thread ${worker.threadId} error: \n${err.stack}`, { err: marshalErrorLike(err) });
        });
        worker.once('exit', () => {
            worker.off('message', handler);
            this.workers.delete(worker);
        });


        this.logger.debug(`Worker thread started: ${worker.threadId}`, { tid: worker.threadId });

        return worker;
    }

    clearIdleWorkers() {
        for (const [worker, { ongoingTasks, openPorts }] of this.workers) {
            if (ongoingTasks === 0 && openPorts === 0) {
                worker.terminate();
            }
        }
    }

    getWorker() {
        const allWorkers = Array.from(this.workers.entries());
        const workerWithMinTasks = _.minBy(allWorkers, ([, { ongoingTasks }]) => ongoingTasks);

        if (workerWithMinTasks?.[1].ongoingTasks) {
            if (this.workers.size < this.maxWorkers) {
                return this.createWorker();
            }

            return workerWithMinTasks[0];
        }

        return workerWithMinTasks?.[0] ?? this.createWorker();
    }

    @perNextTick()
    notifyOngoingTasks() {
        if (isMainThread) {
            return;
        }
        parentPort?.postMessage({
            channel: this.constructor.name,
            event: 'reportOngoingTasks',
            ongoingTasks: this.ongoingTasks,
            openPorts: this.pseudoTransfer.openPorts.size,
        } as WorkerStatusReport);
    }

    Threaded(opts?: Partial<RPCOptions>) {
        const o = { stack: '' };
        Error.captureStackTrace(o, this.Threaded);
        const l = o.stack.split('\n')[1];
        const m = l.match(/at .+ \((.+)\:\d+\:\d+\)/);
        const f = m?.[1]?.trim();
        if (f) {
            this.loadInWorker(f);
        }

        const upstreamDecorator = this.Method(opts) as (tgt: typeof AsyncService.prototype, methodName: string, desc: PropertyDescriptor) => unknown;

        return (tgt: typeof AsyncService.prototype, methodName: string, desc: PropertyDescriptor) => {
            const afterDesc: PropertyDescriptor = upstreamDecorator(tgt, methodName, desc) ?? desc;

            if (typeof afterDesc.value !== 'function') {
                throw new Error('Threaded decorator can only be applied to methods');
            }

            const originalMethod = afterDesc.value;
            const funcName = Array.isArray(opts?.name) ? opts!.name[0] : (opts?.name || methodName);
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const self = this;
            function wrappedMethod(this: AsyncService, ...args: any[]) {
                if (self.runInThread === RUN_IN_THREAD.CHILD_THREAD) {
                    return self.exec(funcName, args);
                }

                return originalMethod.apply(this, args);
            }

            Object.defineProperty(wrappedMethod, 'name', { value: `threadedWrapped${funcName[0].toUpperCase()}${funcName.slice(1)}` });

            afterDesc.value = wrappedMethod;

            return afterDesc;
        };

    }

    override async exec(name: string, input: object, env?: any) {
        await this.serviceReady();
        if (this.runInThread === RUN_IN_THREAD.CHILD_THREAD) {
            const worker = this.getWorker();
            const deferred = Defer<any>();
            const { port1, port2 } = new MessageChannel();
            const m = {
                name,
                input,
                env: {
                    ...env,
                    asyncContext: this.asyncContext.ctx,
                },
            };
            const { data, profiles, transferList } = this.pseudoTransfer.composeTransferable(m);

            worker.postMessage({
                channel: this.constructor.name,
                event: 'exec',
                data: data,
                dataProfiles: profiles,
                port: port2,
            }, [port2, ...transferList]);
            const workerCrashHandler = (err: any) => {
                deferred.reject(err);
            };
            worker.once('error', workerCrashHandler);
            port1.on('message', (msg) => {
                worker.off('error', workerCrashHandler);
                switch (msg?.kind) {
                    case 'return': {
                        deferred.resolve(this.pseudoTransfer.mangleTransferred(port1, msg.data, msg.dataProfiles));
                        port1.close();
                        break;
                    }
                    case 'throw': {
                        deferred.reject(this.pseudoTransfer.mangleTransferred(port1, msg.data, msg.dataProfiles));
                        port1.close();
                        break;
                    }
                    case 'remoteObjectReference': {
                        this.pseudoTransfer.handleRemoteAction(msg.port, data);
                        break;
                    }
                    default: {
                        deferred.reject(new Error('Protocol error: unknown message kind'));
                        break;
                    }
                }
            });

            return deferred.promise;
        }

        this.ongoingTasks += 1;
        this.notifyOngoingTasks();

        if (env?.asyncContext) {
            this.asyncContext.setup();
            Object.assign(this.asyncContext.ctx, env.asyncContext);
        }


        try {
            const codeHostClass = this.host(name);
            const hostIsAsyncService = codeHostClass instanceof AsyncService;
            if (hostIsAsyncService && codeHostClass.serviceStatus !== 'ready') {
                await codeHostClass.serviceReady();
            }

            return super.exec(name, input, env);
        } finally {
            this.ongoingTasks -= 1;
            this.notifyOngoingTasks();
        }
    }

    override fitInputToArgs(name: string, input: object) {
        const reflect = Reflect.get(input, RPC_REFLECT);

        if (Array.isArray(reflect.input)) {
            return reflect.input;
        }

        return super.fitInputToArgs(name, input);
    }

    initWorker() {
        if (isMainThread) {
            return;
        }
        if (workerData.type !== this.constructor.name) {
            return;
        }

        process.on('error', (err: any) => {
            this.logger.error(`Uncaught error in thread ${threadId}`, { err: marshalErrorLike(err) });
            process.exit();
        });

        this.logger.debug(`Remote informed ${workerData.filesToLoad?.length || 0} files to load in thread ...`, { tid: threadId });

        for (const x of workerData.filesToLoad) {
            this.filesToLoad.add(x);
        }

        for (const f of this.filesToLoad) {
            require(f);
        }

        this.notifyOngoingTasks();
        setInterval(() => this.notifyOngoingTasks(), 1000).unref();

        parentPort!.on('message', async (msg) => {
            if (msg?.channel === this.constructor.name && msg.event === 'exec') {
                const m = this.pseudoTransfer.mangleTransferred(msg.port, msg.data, msg.dataProfiles);
                try {
                    const r = await this.exec(m.name, m.input, m.env);
                    this.pseudoTransfer.transferOverTheWire(msg.port, {
                        kind: 'return',
                        data: r,
                    });
                } catch (err: any) {
                    this.pseudoTransfer.transferOverTheWire(msg.port, {
                        kind: 'throw',
                        data: err,
                    });
                }
            }
        });
        parentPort!.once('error', (err) => {
            console.error(err);
            process.exit(1);
        });

        this.logger.debug(`Thread fully set up.`, { tid: threadId, filesLoaded: this.filesToLoad.size });

    }

    override decorators() {
        return {
            ...super.decorators(),
            Threaded: this.Threaded.bind(this),
        };
    }
}
