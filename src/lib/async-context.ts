import { createHook, executionAsyncId } from 'async_hooks';
import { randomUUID } from 'crypto';
import { AsyncService } from './async-service';

export interface TraceCtx {
    traceId?: string;
    traceT0?: Date;
    [k: string | symbol]: any;
}

const trackings: Array<Map<number, number | object>> = [];

export const tracerHook = createHook({
    // triggerAsyncId is the asyncId of the resource that caused (or "triggered") the new resource to initialize 
    // and that caused init to call. This is different from async_hooks.executionAsyncId() that only shows when a resource was created, 
    // while triggerAsyncId shows why a resource was created.
    init(asyncId, _type, _triggerAsyncId, _resource) {
        const whenParent = executionAsyncId();
        for (const idBasedTracking of trackings) {
            const upstreamTracked = idBasedTracking.get(whenParent);
            if (typeof upstreamTracked === 'number') {
                idBasedTracking.set(asyncId, upstreamTracked);
            } else if (typeof upstreamTracked === 'object') {
                idBasedTracking.set(asyncId, whenParent);
            }
        }
    },
    destroy(asyncId) {
        for (const idBasedTracking of trackings) {
            idBasedTracking.delete(asyncId);
        }
    }
}).enable();

export function setupTracker() {
    const idBasedTracking = new Map<number, number | object>();
    trackings.push(idBasedTracking);

    return {
        getStore(asyncId: number) {
            const l1 = idBasedTracking.get(asyncId);
            if (typeof l1 === 'number') {
                const l2 = idBasedTracking.get(l1);
                if (typeof l2 !== 'object') {
                    throw new Error('Corrupted async context');
                }

                return l2;
            }

            return l1;
        },
        getCurrentStore() {
            return this.getStore(executionAsyncId());
        },
        track(asyncId: number) {
            if (idBasedTracking.has(asyncId)) {
                return this.getStore(asyncId)!;
            }

            const obj = {};
            idBasedTracking.set(asyncId, obj);

            return obj as object;
        },
        trackCurrent() {
            return this.track(executionAsyncId());
        },
        dismiss() {
            const idx = trackings.indexOf(idBasedTracking);
            if (idx >= 0) {
                trackings.splice(idx, 1);
            }
        }
    };
}

export const defaultTracker = setupTracker();

export function setupTraceCtx(input: Partial<TraceCtx> = {}) {
    const currentResource = defaultTracker.trackCurrent();

    const ctx: TraceCtx = currentResource!;
    Object.assign(ctx, {
        ...input
    });
    ctx.traceId ??= randomUUID();
    ctx.traceT0 ??= new Date();

    return ctx;
}

export function setupTraceId(traceId?: string, traceT0?: Date) {
    return setupTraceCtx({ traceId, traceT0 });
}

export function getTraceCtx() {
    try {
        return defaultTracker.getCurrentStore() as TraceCtx | undefined;
    } catch (err) {
        return undefined;
    }
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
        try {
            this.ctx[k] = v;

            return v;
        } catch (err) {
            return undefined;
        }
    }

}
