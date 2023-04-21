import { AsyncService } from './async-service';
import { createHook, executionAsyncResource } from 'async_hooks';
import { randomUUID } from 'crypto';
import { Writable } from 'stream';

const logLevels = {
    FATAL: 'fatal',
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug',
    TRACE: 'trace'
} as const;

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

export abstract class AbstractLogger extends AsyncService {
    abstract _targetStream: Writable;

    bindings: Record<string, any> = {
        pid: process.pid,
        host: process.env.HOSTNAME || process.env.HOST || 'unknown',
    };

    constructor(...whatever: any[]) {
        super(...whatever);
    }

    override init(stream?: Writable) {
        this._targetStream = stream || process.stderr;
    }

    log(...args: any[]) {
        const texts: string[] = [];
        const objects: object[] = [this.bindings];

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

        return this._targetStream.write(Object.assign({ message: texts.join(' '), date: new Date() }, ...objects));
    }

    child(bindings: object) {
        const childLogger = Object.create(this) as this;

        childLogger.bindings = Object.assign({}, this.bindings, bindings);

        return childLogger;
    }
}

for (const level of Object.values(logLevels)) {
    AbstractLogger.prototype[level] = function (...args: any[]) {
        return this.log({ level }, ...args);
    };
}

export interface LoggerInterface {
    error(message: string, ...args: any[]): void;
    error(obj: unknown, message?: string, ...args: any[]): void;

    warn(message: string, ...args: any[]): void;
    warn(obj: unknown, message?: string, ...args: any[]): void;

    info(message: string, ...args: any[]): void;
    info(obj: unknown, message?: string, ...args: any[]): void;

    debug(message: string, ...args: any[]): void;
    debug(obj: unknown, message?: string, ...args: any[]): void;

    fatal(message: string, ...args: any[]): void;
    fatal(obj: unknown, message?: string, ...args: any[]): void;

    trace(message: string, ...args: any[]): void;
    trace(obj: unknown, message?: string, ...args: any[]): void;

    log(message: string, ...args: any[]): void;
    log(obj: unknown, message?: string, ...args: any[]): void;

    child(binding: object): LoggerInterface;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface AbstractLogger extends LoggerInterface { }
