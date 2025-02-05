import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { AsyncService } from './async-service';

export interface TraceCtx {
    traceId?: string;
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

    run<T extends object, R>(func: () => R, base?: T) {
        let ctx = this.asyncLocalStorage.getStore();
        ctx ??= base;

        return this.asyncLocalStorage.run({ ...ctx, ...base }, func);
    }

    merge<T extends object>(input: T) {
        const r = Object.assign(this.ctx, input);

        return r;
    }

    get ctx() {
        const ctx = this.asyncLocalStorage.getStore();
        if (!ctx) {
            throw new Error('No context available');
        }
        return ctx;
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

export function setupTraceId(traceId: string = randomUUID(), traceT0: Date = new Date()) {
    return setupTraceCtx({ traceId, traceT0 });
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

