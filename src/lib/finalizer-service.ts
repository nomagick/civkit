import { runOnce } from '../decorators/once';
import type { DependencyContainer } from 'tsyringe';
import { AsyncService } from './async-service';
import type { LoggerInterface } from './logger';

export abstract class AbstractFinalizerService extends AsyncService {
    abstract logger: LoggerInterface;
    abstract container: DependencyContainer;

    processFinalizers: Array<[Function, object | undefined, ...any[]]> = [];

    override init() {
        process.on('uncaughtException', this.onUncaughtException.bind(this));

        process.on('unhandledRejection', this.onUnhandledRejection.bind(this));

        process.on('SIGTERM', () => {
            this.logger.warn('Received SIGTERM');
            this.terminate();
        });
        process.on('SIGINT', () => {
            this.logger.warn('Received SIGINT');
            this.terminate();
        });

        this.emit('ready');
    }

    onUncaughtException(err: Error, _origin: NodeJS.UncaughtExceptionOrigin) {
        this.logger.error(`Uncaught exception in pid ${process.pid}, quitting`, {
            pid: process.pid,
            err
        });
        this.logger.error(`Stacktrace: \n${err?.stack}`);

        this.terminate(err);
    }

    onUnhandledRejection(err: unknown, _triggeringPromise: Promise<unknown>) {
        this.logger.error(`Uncaught exception in pid ${process.pid}, quitting`, {
            pid: process.pid,
            err: err as any,
        });
        if ((err as Error)?.stack) {
            this.logger.error(`Stacktrace: \n${(err as Error).stack}`);
        }

        this.terminate(err);
    }

    registerProcessFinalizer(func: Function, thisArg?: object | undefined, ...args: any[]) {
        this.processFinalizers.push([func, thisArg, ...args]);
    }

    registerIoCProcessFinalizer(tgt: any, prop: string) {
        this.registerProcessFinalizer(tgt[prop], this.container.resolve(tgt.constructor));
    }

    Finalizer() {
        return (tgt: object, prop: string) => {
            process.nextTick(() => {
                this.registerIoCProcessFinalizer(tgt, prop);
            });
        };
    }

    decorators() {
        const Finalizer = this.Finalizer.bind(this);

        return {
            Finalizer
        };
    }

    quitProcess(...args: Parameters<typeof process.exit>) {
        return process.exit(...args);
    }

    @runOnce()
    async terminate(err?: unknown) {
        if (err) {
            this.logger.error('Process terminating because of error', { err });
        } else {
            this.logger.warn('Process terminating');
        }

        await this.teardown();

        this.logger.info(`All done. Process exit.`);
        this.quitProcess(err ? 1 : 0);
    }

    @runOnce()
    async teardown() {
        const totalFinalizers = this.processFinalizers.length;
        let i = totalFinalizers;
        const finalizers = this.processFinalizers.reverse();
        for (const [idx, [func, thisArg, ...args]] of finalizers.entries()) {
            const signature = thisArg ? `${Object.getPrototypeOf(thisArg).constructor.name}::${func.name}` : func.name;
            const n = idx + 1;
            this.logger.info(`Running finalizer: ${signature} ${n}/${totalFinalizers}`);
            try {
                await func.apply(thisArg, args);
                this.logger.info(`Finalizer ${signature}#${n} completed. ${i - 1} to go.`);
            } catch (err) {
                this.logger.info(`Finalizer ${signature}#${n} thrown up 🤷. ${i - 1} to go.`, { err });
            } finally {
                i -= 1;
            }
        }
    }
}
