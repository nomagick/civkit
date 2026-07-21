import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes } from 'crypto';
import { AsyncService } from './async-service';

export interface TraceCtx {
    traceId?: string;
    spanId?: string;
    parentSpanId?: string;
    traceT0?: Date;
    [k: string | symbol]: any;
}

export const defaultAsyncLocalStorage = new AsyncLocalStorage<Record<string | number | symbol, any>>();

export abstract class AbstractAsyncContext extends AsyncService {
    asyncLocalStorage = new AsyncLocalStorage<Record<string | number | symbol, any>>();

    override init() {
        this.emit('ready');
    }

    setup<T extends object>(base: T = {} as any) {
        let ctx = this.asyncLocalStorage.getStore();
        ctx ??= base;
        if (ctx !== base) {
            Object.assign(ctx, base);
        }

        this.asyncLocalStorage.enterWith(ctx);

        return ctx;
    }

    run<T extends object, R>(func: () => R, base: T = {} as any) {
        let ctx = this.asyncLocalStorage.getStore();
        ctx ??= base;
        if (ctx !== base) {
            Object.assign(ctx, base);
        }

        return this.asyncLocalStorage.run(ctx, func);
    }

    bridge<T extends object, R, TArgs extends any[]>(ctx: T, func: (...args1: TArgs) => R): R;
    bridge<T extends object, R, TArgs extends any[]>(ctx: T, func: (...args1: TArgs) => R, ...args: TArgs): R;
    bridge<T extends object, R, TArgs extends any[]>(ctx: T, func: (...args1: TArgs) => R, ...args: TArgs) {
        return this.asyncLocalStorage.run(ctx, func, ...args);
    }

    implicitBridge<T extends object>(ctx: T) {
        return this.asyncLocalStorage.enterWith(ctx);
    }

    bridged<T extends object, R, TArgs extends any[]>(func: (...args: TArgs) => R, ctx: T = this.ctx) {
        return (...args: TArgs) => {
            return this.asyncLocalStorage.run(ctx, func, ...args);
        };
    }

    merge<T extends object>(input: T) {
        const r = Object.assign(this.ctx, input);

        return r;
    }


    fork<T extends object, R, TArgs extends any[]>(ctx: T, func: (...args1: TArgs) => R): R;
    fork<T extends object, R, TArgs extends any[]>(ctx: T, func: (...args1: TArgs) => R, ...args: TArgs): R;
    fork<T extends object, R, TArgs extends any[]>(ctx: T, func: (...args1: TArgs) => R, ...args: TArgs) {
        return this.asyncLocalStorage.run(Object.create(ctx), func, ...args);
    }
    forked<T extends object, R, TArgs extends any[]>(func: (...args: TArgs) => R, ctx: T = this.ctx) {
        return (...args: TArgs) => {
            return this.asyncLocalStorage.run(Object.create(ctx), func, ...args);
        };
    }

    get ctx() {
        const ctx = this.asyncLocalStorage.getStore();
        if (!ctx) {
            throw new Error('No context available');
        }
        return ctx;
    }

    available() {
        return !!this.asyncLocalStorage.getStore();
    }

    get<T = any>(k: string | number | symbol): T | undefined {
        try {
            return this.ctx?.[k];
        } catch (err) {
            return undefined;
        }
    }

    set<T = any>(k: string | number | symbol, v: T) {
        try {
            this.ctx[k] = v;

            return v;
        } catch (err) {
            return undefined;
        }
    }

}

export class GlobalAsyncContext extends AbstractAsyncContext {
    constructor(...args: any[]) {
        super(...args);
        this.init();
        this.asyncLocalStorage = defaultAsyncLocalStorage;
    }
}
export const defaultAsyncContext = new GlobalAsyncContext();

export function setupTraceCtx(input?: Partial<TraceCtx>) {
    return defaultAsyncContext.setup(input);
}

function _getTraceId() {
    return randomBytes(16).toString('hex');
}
function _getSpanId() {
    return randomBytes(8).toString('hex');
}

export function parseTraceparent00(traceparent: string) {
    const parts = traceparent.split('-');
    const [version, traceId, spanId, traceFlags] = parts;
    if (version !== '00') {
        return;
    }

    return {
        traceId,
        spanId,
        traceFlags,
    };
}

export function setupTraceId(traceId: string = _getTraceId(), traceT0: Date = new Date()) {
    return setupTraceCtx({ traceId, traceT0, spanId: _getSpanId() });
}

export function getTraceCtx() {
    try {
        return defaultAsyncContext.ctx as TraceCtx | undefined;
    } catch (err) {
        return undefined;
    }
}

export function getTraceId() {
    return getTraceCtx()?.traceId;
}

