"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.indefiniteLoop = exports.INNER_CALL_SYMBOL = void 0;
const hash_1 = require("../lib/hash");
const defer_1 = require("../lib/defer");
const weakRef = new WeakMap();
let counter = 1;
function _idOf(obj) {
    let id = weakRef.get(obj);
    if (id) {
        return id;
    }
    id = counter++;
    weakRef.set(obj, id);
    return id;
}
exports.INNER_CALL_SYMBOL = Symbol('IndefiniteLoop Inner Call');
function indefiniteLoop(concurrency = 1, terminator = null) {
    const callParamResultMap = new Map();
    const callParamConcurrencyMap = new Map();
    return function indefiniteLoopDecorator(_target, _propName, propDesc) {
        const func = propDesc.value;
        if (typeof func !== 'function') {
            throw new Error('Invalid use of indefiniteLoop decorator');
        }
        function workerFunc(...argv) {
            let isInnerCall = true;
            const lastParam = argv.pop();
            if (lastParam !== exports.INNER_CALL_SYMBOL) {
                argv.push(lastParam);
                isInnerCall = false;
            }
            const paramHash = hash_1.objHashMd5B64Of([this, ...argv].map((x) => {
                if (typeof x === 'object' || typeof x === 'function') {
                    return _idOf(x);
                }
                return x;
            }));
            if (!isInnerCall && callParamResultMap.has(paramHash)) {
                return callParamResultMap.get(paramHash).promise;
            }
            let quota = callParamConcurrencyMap.get(paramHash);
            if (quota === undefined) {
                quota = concurrency;
            }
            if (quota <= 0) {
                return;
            }
            quota -= 1;
            callParamConcurrencyMap.set(paramHash, quota);
            try {
                const r = func.apply(this, argv);
                if (r.then && ((typeof r.then) === 'function')) {
                    r.catch((err) => {
                        callParamConcurrencyMap.delete(paramHash);
                        callParamResultMap.get(paramHash)?.reject(err);
                        callParamResultMap.delete(paramHash);
                    });
                    do {
                        r.then((r) => {
                            if (r === terminator) {
                                callParamConcurrencyMap.delete(paramHash);
                                callParamResultMap.get(paramHash)?.resolve();
                                callParamResultMap.delete(paramHash);
                                return;
                            }
                            const curn = callParamConcurrencyMap.get(paramHash) || 0;
                            callParamConcurrencyMap.set(paramHash, curn + 1);
                            return workerFunc.apply(this, [...argv, exports.INNER_CALL_SYMBOL]);
                        }, (err) => {
                            callParamConcurrencyMap.delete(paramHash);
                            callParamResultMap.get(paramHash)?.reject(err);
                            callParamResultMap.delete(paramHash);
                        });
                        quota -= 1;
                    } while (quota > 0);
                    if (!isInnerCall) {
                        const deferred = defer_1.Defer();
                        callParamResultMap.set(paramHash, deferred);
                        return deferred.promise;
                    }
                    return;
                }
                if (!isInnerCall) {
                    callParamResultMap.set(paramHash, defer_1.Defer());
                }
                if (r === terminator) {
                    callParamConcurrencyMap.delete(paramHash);
                    callParamResultMap.get(paramHash)?.resolve();
                    callParamResultMap.delete(paramHash);
                    return callParamResultMap.get(paramHash).promise;
                }
                callParamConcurrencyMap.set(paramHash, quota + 1);
                while (quota > 0) {
                    setImmediate(workerFunc.bind(this), ...argv, exports.INNER_CALL_SYMBOL);
                    quota -= 1;
                }
                return callParamResultMap.get(paramHash).promise;
            }
            catch (err) {
                const resultPromise = callParamResultMap.get(paramHash)?.promise;
                callParamConcurrencyMap.delete(paramHash);
                callParamResultMap.get(paramHash)?.reject(err);
                callParamResultMap.delete(paramHash);
                return resultPromise;
            }
        }
        propDesc.value = workerFunc;
        return propDesc;
    };
}
exports.indefiniteLoop = indefiniteLoop;
//# sourceMappingURL=indefinite-loop.js.map