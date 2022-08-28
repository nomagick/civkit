import { AsyncService } from './async-service';
import pino from 'pino';
import { executionAsyncResource } from 'async_hooks';

export interface LoggerInterface {
    error(message: string, ...args: any[]): void;
    error(obj: object, message?: string, ...args: any[]): void;

    warn(message: string, ...args: any[]): void;
    warn(obj: object, message?: string, ...args: any[]): void;

    info(message: string, ...args: any[]): void;
    info(obj: object, message?: string, ...args: any[]): void;

    debug(message: string, ...args: any[]): void;
    debug(obj: object, message?: string, ...args: any[]): void;

    fatal(message: string, ...args: any[]): void;
    fatal(obj: object, message?: string, ...args: any[]): void;

    trace(message: string, ...args: any[]): void;
    trace(obj: object, message?: string, ...args: any[]): void;

    silent(message: string, ...args: any[]): void;
    silent(obj: object, message?: string, ...args: any[]): void;
}

export type LoggerOptions = pino.LoggerOptions;

const logLevels: Array<keyof LoggerInterface> = [
    'fatal',
    'error',
    'warn',
    'info',
    'debug',
    'trace',
    'silent'
];

export const REQUEST_ID = Symbol('requestId');
export interface ResourceInterface {
    [REQUEST_ID]?: string;
}

function wipeBehindPinoFunction(level: keyof LoggerInterface, binding?: object) {
    return function patchedLogger(this: AbstractLogger, ...args: any[]) {
        const thePino = this.logger;
        const logFunc = thePino[level] as pino.LogFn;
        const texts: string[] = [];
        const objects: object[] = [];

        let errCounter = 0;
        for (const x of args) {
            if (!x) {
                continue;
            }
            if (typeof x === 'string') {
                texts.push(x);
            } else {
                if (x instanceof Error) {
                    objects.push({ [`err${errCounter || ''}`]: x });
                    errCounter++;
                }
                objects.push(x);
            }
        }

        const resource: ResourceInterface = executionAsyncResource();
        if (resource?.[REQUEST_ID]) {
            objects.push({ 'requestId': resource[REQUEST_ID] });
        }

        return logFunc.call(thePino, Object.assign({}, binding, ...objects), texts.join(' '));
    };
}

export abstract class AbstractLogger extends AsyncService {
    abstract logger: LoggerInterface;
    abstract loggerOptions: LoggerOptions;

    constructor(...whatever: any[]) {
        super(...whatever);
    }

    override init(stream?: pino.DestinationStream) {
        this.logger = pino(this.loggerOptions, stream as any);
    }

    child(bindings: object) {
        const childLogger: LoggerInterface = {} as any;

        Object.defineProperty(childLogger, 'logger', {
            get: () => this.logger
        });

        for (const level of logLevels) {
            (childLogger as any)[level] = wipeBehindPinoFunction(level, bindings) as pino.LogFn;
        }

        return childLogger;
    }
}

for (const level of logLevels) {
    (AbstractLogger.prototype as any)[level] = wipeBehindPinoFunction(level);
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface AbstractLogger extends LoggerInterface { }
