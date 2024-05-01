import { errorMonitor, EventEmitter } from 'events';
import type { InjectionToken } from 'tsyringe';
import { Defer, TimeoutError } from './defer';

const initFuncPatchTrack = new WeakSet();

const nextTickFunc = process?.nextTick || setImmediate || setTimeout;
export abstract class AsyncService extends EventEmitter {
    protected __serviceReady: Promise<this>;

    protected __dependencies: Set<AsyncService>;

    protected __status: 'ready' | 'crippled' | 'pending' | 'init' | 'error';

    constructor(...argv: (AsyncService | InjectionToken)[]) {
        super();
        this.__status = 'init';

        this.__dependencies = new Set();

        this.dependsOn(...argv);

        const readyDeferred = Defer();

        this.__serviceReady = readyDeferred.promise;
        readyDeferred.promise.catch(() => 'Not considered uncaught rejection');

        this.once('ready', () => {
            readyDeferred.resolve(this);
        });

        this.once(errorMonitor, (err) => {
            readyDeferred.reject(err);
        });

        this.on(errorMonitor, () => {
            this.__status = 'error';
        });


        this.on('crippled', () => {
            this.__status = 'crippled';
        });

        this.on('ready', () => {
            this.__status = 'ready';
        });

        if (this.constructor.prototype.hasOwnProperty('init') && !initFuncPatchTrack.has(this.constructor.prototype)) {
            const origFunc: Function = this.init;
            // eslint-disable-next-line no-inner-declarations
            function patchedInit(this: AsyncService) {
                if (this.__status !== 'ready') {
                    this.__status = 'pending';
                    this.emit('pending');
                }

                return origFunc.call(this, ...arguments);
            }
            this.constructor.prototype.init = patchedInit;
            initFuncPatchTrack.add(this.constructor.prototype);
        }

    }

    get serviceStatus() {
        return this.__status;
    }

    init(..._args: any[]): any {
        // init is for service initialization.
        // Service should have status `pending` during init, and `ready` after init.
        // It should declare ready using `this.emit('ready')` at some point.
        throw new Error('Not implemented');
    }

    standDown(): any {
        // standDown is mainly for manual service suspension.
        // Service should have status `init` after stand-down.
        this.__status = 'init';
        this.emit('stand-down');
    }

    dependsOn(...argv: any[]) {
        for (const x of argv) {
            if (x instanceof AsyncService) {
                this.__dependencies.add(x);
            }
        }
    }

    serviceReady(): Promise<this> {
        if (this.__status === 'crippled' || this.__status === 'init') {
            this.__status = 'pending';

            this.__serviceReady = new Promise((_resolve, _reject) => {
                this.once('error', _reject);
                this.once('ready', () => {
                    _resolve(this);
                    this.removeListener('error', _reject);
                });
                this.dependencyReady().catch((err) => this.emit('error', err));
            });

            nextTickFunc(() => {
                try {
                    const r = this.init();
                    if (r && typeof r.catch === 'function') {
                        r.catch((err: any) => {
                            this.emit('error', err);
                        });
                    }
                } catch (err) {
                    this.emit('error', err);
                }
            });
        }

        return this.__serviceReady;
    }

    dependencyReady(timeoutMilliseconds: number = 30000): Promise<AsyncService[]> {
        return new Promise((_resolve, _reject) => {
            const timer = setTimeout(() => {
                _reject(new TimeoutError(`Timeout waiting for dependencies(${[...this.__dependencies].filter((x) => x.__status !== 'ready').map((x) => `${x.constructor.name}`).join(', ')}) to be ready for ${this.constructor.name}.`));
            }, timeoutMilliseconds);


            Promise.all([...this.__dependencies].map((x) => x.serviceReady())).then((r) => {
                for (const x of r) {
                    if (x.__status !== 'ready') {
                        // Someone crippled, try activation again

                        return this.dependencyReady();
                    }
                }

                clearTimeout(timer);

                return r;
            }).then(_resolve, _reject);
        });
    }
}

export interface AsyncService {
    on(event: 'ready', listener: () => void): this;
    on(event: 'crippled', listener: (err?: Error | any) => void): this;
    on(event: 'pending', listener: (err: Error) => void): this;
    on(event: 'stand-down', listener: (err: Error) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
}
