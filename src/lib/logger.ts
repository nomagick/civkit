import { AsyncService } from './async-service';
import pino from 'pino';
import { createHook, executionAsyncResource } from 'async_hooks';
import { randomUUID } from 'crypto';

export type LoggerOptions = pino.LoggerOptions;
export type LoggerInterface = pino.Logger;

const logLevels = {
    FATAL: 'fatal',
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug',
    TRACE: 'trace'
} as const;

type Level = typeof logLevels[keyof typeof logLevels];

export const TRACE_ID = Symbol('TraceID');
export interface TraceableInterface {
    [TRACE_ID]?: string;
}

export const tracerHook = createHook({
    init(_asyncId, _type, _triggerAsyncId, resource: TraceableInterface) {
        const currentResource: TraceableInterface = executionAsyncResource();
        if (currentResource?.[TRACE_ID]) {
            resource[TRACE_ID] = currentResource[TRACE_ID];
        }
    }
});

export function setupTraceId(traceId?: string) {
    tracerHook.enable();
    const currentResource: TraceableInterface = executionAsyncResource();
    if (currentResource) {
        currentResource[TRACE_ID] = traceId || randomUUID();

        return currentResource[TRACE_ID];
    }

    return undefined;
}

export function getTraceId() {
    const currentResource: TraceableInterface = executionAsyncResource();

    return currentResource?.[TRACE_ID];
}


function wipeBehindPinoFunction(level: Level, binding?: object) {

    return function patchedLogger(this: AbstractLogger, ...args: any[]) {
        const thePino = this.logger;
        const logFunc = thePino[level];
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

        const resource: TraceableInterface = executionAsyncResource();
        if (resource?.[TRACE_ID]) {
            objects.push({ 'traceId': resource[TRACE_ID] });
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

    override init(stream: pino.DestinationStream) {
        this.logger = pino(this.loggerOptions, stream);
    }

    child(bindings: object) {
        const childLogger = {} as LoggerInterface;

        Object.defineProperty(childLogger, 'logger', {
            get: () => this.logger
        });

        for (const level of Object.values(logLevels)) {
            childLogger[level] = wipeBehindPinoFunction(level, bindings);
        }

        return childLogger;
    }
}

for (const level of Object.values(logLevels)) {
    AbstractLogger.prototype[level] = wipeBehindPinoFunction(level);
}

export interface AbstractLogger {
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
}
