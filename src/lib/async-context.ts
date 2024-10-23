import { createHook, executionAsyncId, executionAsyncResource } from 'async_hooks';
import { randomUUID } from 'crypto';
import { AsyncService } from './async-service';

export interface TraceCtx {
    traceId?: string;
    traceT0?: Date;
    [k: string | symbol]: any;
}

const idBasedTrackings: Array<Map<number, number | object>> = [];
const resourceBasedTrackings: Array<WeakMap<object, object>> = [];

export const tracerHook = createHook({
    // triggerAsyncId is the asyncId of the resource that caused (or "triggered") the new resource to initialize 
    // and that caused init to call. This is different from async_hooks.executionAsyncId() that only shows when a resource was created, 
    // while triggerAsyncId shows why a resource was created.
    init(asyncId, _type, _triggerAsyncId, resource) {
        const whenParent = executionAsyncId();
        const parentResource = executionAsyncResource();

        for (const idBasedTracking of idBasedTrackings) {
            const upstreamTracked = idBasedTracking.get(whenParent);
            if (typeof upstreamTracked === 'number') {
                idBasedTracking.set(asyncId, upstreamTracked);
            } else if (typeof upstreamTracked === 'object') {
                idBasedTracking.set(asyncId, whenParent);
            }
        }

        for (const resourceBasedTracking of resourceBasedTrackings) {
            const upstreamTracked = resourceBasedTracking.get(parentResource);
            if (upstreamTracked) {
                resourceBasedTracking.set(resource, upstreamTracked);
            }
        }
    },
    destroy(asyncId) {
        for (const idBasedTracking of idBasedTrackings) {
            idBasedTracking.delete(asyncId);
        }
    }
}).enable();

export function setupIdBasedTracker() {
    const idBasedTracking = new Map<number, number | object>();
    idBasedTrackings.push(idBasedTracking);

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
            const idx = idBasedTrackings.indexOf(idBasedTracking);
            if (idx >= 0) {
                idBasedTrackings.splice(idx, 1);
            }
        }
    };
}

export function setupResourceBasedTracker() {
    const resourceBasedTracking = new WeakMap<object, object>();
    resourceBasedTrackings.push(resourceBasedTracking);

    return {
        getStore(asyncResource: object) {
            return resourceBasedTracking.get(asyncResource);
        },
        getCurrentStore() {
            return this.getStore(executionAsyncResource());
        },
        track(asyncResource: object) {
            if (resourceBasedTracking.has(asyncResource)) {
                return this.getStore(asyncResource)!;
            }

            const obj = {};
            resourceBasedTracking.set(asyncResource, obj);

            return obj as object;
        },
        trackCurrent() {
            return this.track(executionAsyncResource());
        },
        dismiss() {
            const idx = resourceBasedTrackings.indexOf(resourceBasedTracking);
            if (idx >= 0) {
                idBasedTrackings.splice(idx, 1);
            }
        }
    };
}

export let defaultTracker: ReturnType<typeof setupResourceBasedTracker> | ReturnType<typeof setupIdBasedTracker> = setupIdBasedTracker();

export function useIdBasedDefaultTracker() {
    defaultTracker.dismiss();
    defaultTracker = setupIdBasedTracker();
}

export function useResourceBasedDefaultTracker() {
    defaultTracker.dismiss();
    defaultTracker = setupResourceBasedTracker();
}

export function setupTraceCtx(input?: Partial<TraceCtx>) {
    const currentResource = defaultTracker.trackCurrent();

    const ctx: TraceCtx = currentResource!;

    if (input && typeof input === 'object') {
        Object.assign(ctx, {
            ...input
        });
    }

    return ctx;
}

export function setupTraceId(traceId: string = randomUUID(), traceT0: Date = new Date()) {
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
