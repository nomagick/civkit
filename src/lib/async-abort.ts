import { executionAsyncId } from "async_hooks";
import { getTraceCtx } from "./async-context";

export const ABORTION_CONTEXT = Symbol('ABORTION_CONTEXT');
export const HEAP_ABORT = Symbol('HEAP_ABORT');
export const STACK_ABORT = Symbol('STACK_ABORT');

export class AbortError extends Error { }

const origThen = Promise.prototype.then;

function then(this: Promise<unknown>, onFulfilled: (i: any) => any, onRejected: (i: any) => any) {

    const handler = (arg: any) => {
        const traceCtx = getTraceCtx();
        const abortionCtx = traceCtx?.[ABORTION_CONTEXT];
        if (!abortionCtx) {
            return onFulfilled?.call(undefined, arg);
        }
        const heapAbort = abortionCtx[HEAP_ABORT];
        if (heapAbort) {
            const err = heapAbort instanceof Error ? heapAbort : new AbortError('Async operation aborted.');
            Error.captureStackTrace(err, handler);

            return Promise.reject(err);
        }
        const curAsyncId = executionAsyncId();
        const stackAbort = abortionCtx[STACK_ABORT]?.[curAsyncId];
        if (stackAbort) {
            const err = stackAbort instanceof Error ? stackAbort : new AbortError('Async operation aborted.');
            Error.captureStackTrace(err, handler);
            return Promise.reject(err);
        }

        return onFulfilled?.call(undefined, arg);
    };

    return (origThen as any).call(this, handler, onRejected);
}

export function setupAsyncAbort() {
    Promise.prototype.then = then;
}
export function dismissAsyncAbort() {
    Promise.prototype.then = origThen;
}
