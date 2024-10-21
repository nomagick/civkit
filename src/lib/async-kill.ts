import { getTraceCtx, setupTraceCtx, AbstractAsyncContext } from "./async-context";

export const ASYNC_KILL = Symbol('ASYNC_KILL');

export class AbortError extends Error { }

const origPromise = Promise;

export class PromiseWithKill<T = void> extends Promise<T> {
    override then(this: Promise<unknown>, onFulfilled: (i: any) => any, onRejected: (i: any) => any) {

        const handler = (arg: any) => {
            const traceCtx = getTraceCtx();
            if (!traceCtx) {
                return onFulfilled?.call(undefined, arg);
            }
            const killed = traceCtx[ASYNC_KILL];
            if (killed) {
                const err = killed instanceof Error ? killed : new AbortError('Async operation aborted.');
                Error.captureStackTrace(err, handler);

                return Promise.reject(err);
            }

            return onFulfilled?.call(undefined, arg);
        };

        return super.then(handler, onRejected);
    }
}

export function setupAsyncKill() {
    if (globalThis.Promise === PromiseWithKill) {
        return;
    }
    globalThis.Promise = PromiseWithKill;
}

export function dismissAsyncKill() {
    if (globalThis.Promise !== PromiseWithKill) {
        return;
    }
    globalThis.Promise = origPromise;
}

setupAsyncKill();

export function asyncKill(err?: Error) {
    const traceCtx = setupTraceCtx();
    traceCtx[ASYNC_KILL] = err || true;
}

export abstract class AbstractAsyncContextWithKill extends AbstractAsyncContext {

    kill(err?: Error) {
        return asyncKill(err);
    }

}
