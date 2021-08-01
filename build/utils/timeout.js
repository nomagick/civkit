"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.delay = exports.timeout = void 0;
const defer_1 = require("../lib/defer");
const noop = () => null;
function timeout(promise, ttl) {
    const deferred = defer_1.Defer();
    promise.then(deferred.resolve, deferred.reject);
    setTimeout(() => {
        promise.catch(noop);
        deferred.reject(new defer_1.TimeoutError(`Operation timedout after ${ttl}ms.`));
        if (typeof promise.cancel === 'function') {
            promise.cancel();
        }
    }, ttl);
    return deferred.promise;
}
exports.timeout = timeout;
function delay(ms) {
    const deferred = defer_1.Defer();
    if (!ms || ms <= 0) {
        deferred.resolve();
        return deferred.promise;
    }
    setTimeout(deferred.resolve, ms, ms);
    return deferred.promise;
}
exports.delay = delay;
//# sourceMappingURL=timeout.js.map