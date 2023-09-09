import { createHook, executionAsyncResource } from 'async_hooks';
import { randomUUID } from 'crypto';
import { AsyncService } from './async-service';

export const TRACE_CTX = Symbol('TraceCtx');
export interface TraceCtx {
    traceId?: string;
    traceT0?: Date;
    [k: string | symbol]: any;
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

export abstract class AbstractAsyncContext extends AsyncService {

    override init() {
        this.emit('ready');
    }

    setup(base: object = {}) {
        const ctx = setupTraceCtx();
        if (Object.getPrototypeOf(ctx) !== Object.prototype) {
            throw new Error('Duplicate async context setup');
        }

        Object.setPrototypeOf(ctx, base);

        return ctx;
    }

    merge<T extends object>(input: T) {
        const r = Object.assign(this.ctx, input);

        return r;
    }

    get ctx() {
        const ctx = getTraceCtx();
        if (!ctx) {
            throw new Error('No context available');
        }
        return ctx;
    }

    get<T = any>(k: string | symbol): T | undefined {
        try {
            return this.ctx?.[k];
        } catch (err) {
            return undefined;
        }
    }

    set<T = any>(k: string | symbol, v: T) {
        this.ctx[k] = v;

        return v;
    }

}
