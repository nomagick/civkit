import { Defer } from '../lib/defer';

export const TRIES_SYMBOL = Symbol('Historical tries');

export function patchRetry<T extends Function>(func: T, maxTries: number, delayInMs: number = 0) {

    function newContextAndRun(thisArg: any, args: any[]) {
        const deferred = Defer<any>();
        let triesLeft = Math.abs(maxTries);
        const errors: any[] = [];
        async function retryWorker(tgt: any, argv: any[]) {
            if (triesLeft <= 0) {
                const lastError = errors.pop();
                if (errors.length && (typeof lastError === 'object')) {
                    lastError[TRIES_SYMBOL] = errors;
                }

                return deferred.reject(lastError);
            }
            let rVal: any;
            triesLeft -= 1;
            try {
                rVal = await func.apply(tgt, argv);
            } catch (err) {
                errors.push(err);
                if (triesLeft > 0) {
                    setTimeout(retryWorker, delayInMs, tgt, argv);
                } else {
                    const lastError = errors.pop();
                    if (errors.length && (typeof lastError === 'object')) {
                        lastError[TRIES_SYMBOL] = errors;
                    }

                    return deferred.reject(lastError);
                }

                return;
            }

            return deferred.resolve(rVal);
        }

        retryWorker(thisArg, args).catch(() => null);

        return deferred.promise;
    }

    function pathedFunc(this: any, ...argv: any[]) {
        return newContextAndRun(this, argv);
    }

    return pathedFunc as any as T;
}

export function retry(maxTries: number, delayInMs: number = 0) {
    return function retryDecorator(_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {

        const originalFunc = descriptor.value;

        descriptor.value = patchRetry(originalFunc, maxTries, delayInMs);

        return descriptor;
    };
}


