"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retry = exports.patchRetry = exports.TRIES_SYMBOL = void 0;
const defer_1 = require("../lib/defer");
exports.TRIES_SYMBOL = Symbol('Historical tries');
function patchRetry(func, maxTries, delayInMs = 0) {
    function newContextAndRun(thisArg, args) {
        const deferred = defer_1.Defer();
        let triesLeft = Math.abs(maxTries);
        const errors = [];
        async function retryWorker(tgt, argv) {
            if (triesLeft <= 0) {
                const lastError = errors.pop();
                if (errors.length && (typeof lastError === 'object')) {
                    lastError[exports.TRIES_SYMBOL] = errors;
                }
                return deferred.reject(lastError);
            }
            let rVal;
            triesLeft -= 1;
            try {
                rVal = await func.apply(tgt, argv);
            }
            catch (err) {
                errors.push(err);
                if (triesLeft > 0) {
                    setTimeout(retryWorker, delayInMs, tgt, argv);
                }
                else {
                    const lastError = errors.pop();
                    if (errors.length && (typeof lastError === 'object')) {
                        lastError[exports.TRIES_SYMBOL] = errors;
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
    function pathedFunc(...argv) {
        return newContextAndRun(this, argv);
    }
    return pathedFunc;
}
exports.patchRetry = patchRetry;
function retry(maxTries, delayInMs = 0) {
    return function retryDecorator(_target, _propertyKey, descriptor) {
        const originalFunc = descriptor.value;
        descriptor.value = patchRetry(originalFunc, maxTries, delayInMs);
        return descriptor;
    };
}
exports.retry = retry;
//# sourceMappingURL=retry.js.map