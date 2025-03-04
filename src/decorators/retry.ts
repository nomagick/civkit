import { Defer } from '../lib/defer';

export const TRIES_SYMBOL = Symbol('Historical tries');

export function patchRetry<T extends Function>(func: T, maxTries: number, delayInMs: number = 0, customizer?: (err: unknown) => boolean | void) {
    function newContextAndRun(thisArg: any, args: any[]) {
        const deferred = Defer<any>();
        let triesLeft = Math.abs(maxTries);
        const errors: any[] = [];
        async function retryWorker(tgt: any, argv: any[]) {
            if (triesLeft <= 0) {
                const lastError = errors.pop();
                if (errors.length && typeof lastError === 'object') {
                    lastError[TRIES_SYMBOL] = errors;
                }

                return deferred.reject(lastError);
            }
            let rVal: any;
            triesLeft -= 1;
            try {
                rVal = await func.apply(tgt, argv);
            } catch (err) {
                let predicate = Boolean(triesLeft > 0);
                if (customizer) {
                    try {
                        const r = customizer.call(tgt, err);
                        if (predicate && typeof r === 'boolean') {
                            predicate = r;
                        }
                    } catch (err2) {
                        if (typeof err2 === 'object') {
                            (err2 as any)[TRIES_SYMBOL] = errors;
                        }
                        
                        return deferred.reject(err2);
                    }
                }
                errors.push(err);
                if (predicate) {
                    setTimeout(retryWorker, delayInMs, tgt, argv);
                } else {
                    const lastError = errors.pop();
                    if (errors.length && typeof lastError === 'object') {
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

    function patchedFunc(this: any, ...argv: any[]) {
        return newContextAndRun(this, argv);
    }

    return patchedFunc as any as T;
}

export function retry(maxTries: number, delayInMs: number = 0) {
    return function retryDecorator(_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
        const func = descriptor.value;

        const newFunc = patchRetry(func, maxTries, delayInMs);

        Object.defineProperty(newFunc, 'name',
            { value: `retryDecorated${(func.name[0] || '').toUpperCase()}${func.name.slice(1)}`, writable: false, enumerable: false, configurable: true }
        );

        descriptor.value = newFunc;

        return descriptor;
    };
}

export function retryWith(customizer: (err: unknown) => boolean | void, maxTries: number, delayInMs: number = 0) {
    return function retryDecorator(_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
        const func = descriptor.value;

        const newFunc = patchRetry(func, maxTries, delayInMs, customizer);

        Object.defineProperty(newFunc, 'name',
            { value: `retryDecorated${(func.name[0] || '').toUpperCase()}${func.name.slice(1)}`, writable: false, enumerable: false, configurable: true }
        );

        descriptor.value = newFunc;

        return descriptor;
    };
}
