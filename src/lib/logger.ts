import { AsyncService } from './async-service';
import { createHook, executionAsyncResource } from 'async_hooks';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { Writable } from 'stream';

const logLevels = {
    FATAL: 'fatal',
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug',
    TRACE: 'trace'
} as const;

export const TRACE_CTX = Symbol('TraceCtx');
export interface TraceCtx {
    traceId?: string;
    traceT0?: Date;
    [k: string]: any;
}
export interface TraceableInterface {
    [TRACE_CTX]?: TraceCtx;
}

export const tracerHook = createHook({
    init(_asyncId, _type, _triggerAsyncId, resource: TraceableInterface) {
        const currentResource: TraceableInterface = executionAsyncResource();
        if (currentResource?.[TRACE_CTX]) {
            resource[TRACE_CTX] = currentResource[TRACE_CTX];
        }
    }
});

export function setupTraceCtx(input: Partial<TraceCtx> = {}) {
    tracerHook.enable();
    const currentResource: TraceableInterface = executionAsyncResource();
    if (currentResource) {
        if (!currentResource[TRACE_CTX]) {
            currentResource[TRACE_CTX] = {
                ...input,
            };
        }

        const ctx = currentResource[TRACE_CTX]!;
        Object.assign(ctx, {
            ...input
        });
        ctx.traceId ??= randomUUID();
        ctx.traceT0 ??= new Date();

        return ctx;
    }

    return undefined;
}

export function setupTraceId(traceId?: string, traceT0?: Date) {
    return setupTraceCtx({ traceId, traceT0 });
}

export function getTraceCtx() {
    const currentResource: TraceableInterface = executionAsyncResource();

    return currentResource?.[TRACE_CTX];
}

export function getTraceId() {
    return getTraceCtx()?.traceId;
}

export abstract class AbstractLogger extends AsyncService {
    abstract _targetStream: Writable;

    bindings: Record<string, any> = {
        pid: process.pid,
        host: hostname() || 'unknown',
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
        if (resource?.[TRACE_CTX]) {
            objects.push({
                traceId: resource[TRACE_CTX].id,
                traceDt: Date.now() - resource[TRACE_CTX].t0!.getTime()
            });
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
