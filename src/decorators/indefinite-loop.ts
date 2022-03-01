import { objHashMd5B64Of } from '../lib/hash';
import { Deferred, Defer } from '../lib/defer';

const weakRef = new WeakMap<object, number>();

let counter = 1;
function _idOf(obj: object | Function) {
    let id = weakRef.get(obj);

    if (id) {
        return id;
    }

    id = counter++;
    weakRef.set(obj, id);

    return id;
}

export const INNER_CALL_SYMBOL = Symbol('IndefiniteLoop Inner Call');

export function indefiniteLoop(concurrency: number = 1, terminator: any = null) {
    const callParamResultMap = new Map<string, Deferred<any>>();
    const callParamConcurrencyMap = new Map<string, number>();

    return function indefiniteLoopDecorator(_target: any, _propName: string | symbol, propDesc: PropertyDescriptor) {

        const func: Function = propDesc.value;
        const refObj = {};

        if (typeof func !== 'function') {
            throw new Error('Invalid use of indefiniteLoop decorator');
        }

        function workerFunc(this: any, ...argv: any[]) {
            let isInnerCall = true;
            const lastParam = argv.pop();
            if (lastParam !== INNER_CALL_SYMBOL) {
                argv.push(lastParam);
                isInnerCall = false;
            }

            const paramHash = objHashMd5B64Of(
                [this, refObj, ...argv].map((x) => {
                    if (typeof x === 'object' || typeof x === 'function') {
                        return _idOf(x);
                    }

                    return x;
                })
            );

            if (!isInnerCall && callParamResultMap.has(paramHash)) {
                return callParamResultMap.get(paramHash)!.promise;
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

                // async function which returns a promise
                if (r.then && ((typeof r.then) === 'function')) {
                    r.catch((err: any) => {
                        callParamConcurrencyMap.delete(paramHash);
                        callParamResultMap.get(paramHash)?.reject(err);
                        callParamResultMap.delete(paramHash);
                    });
                    do {
                        r.then((r: any) => {
                            if (r === terminator) {
                                callParamConcurrencyMap.delete(paramHash);
                                callParamResultMap.get(paramHash)?.resolve();
                                callParamResultMap.delete(paramHash);

                                return;
                            }

                            const curn = callParamConcurrencyMap.get(paramHash) || 0;
                            callParamConcurrencyMap.set(paramHash, curn + 1);

                            return workerFunc.apply(this, [...argv, INNER_CALL_SYMBOL]);
                        }, (err: any) => {
                            callParamConcurrencyMap.delete(paramHash);
                            callParamResultMap.get(paramHash)?.reject(err);
                            callParamResultMap.delete(paramHash);
                        });

                        quota -= 1;
                    } while (quota > 0);

                    if (!isInnerCall) {
                        const deferred = Defer();
                        callParamResultMap.set(paramHash, deferred);

                        return deferred.promise;
                    }

                    return;
                }

                // synchronous function
                if (!isInnerCall) {
                    callParamResultMap.set(paramHash, Defer());
                }

                if (r === terminator) {
                    callParamConcurrencyMap.delete(paramHash);
                    callParamResultMap.get(paramHash)?.resolve();
                    callParamResultMap.delete(paramHash);

                    return callParamResultMap.get(paramHash)!.promise;
                }
                callParamConcurrencyMap.set(paramHash, quota + 1);

                while (quota > 0) {
                    setImmediate(workerFunc.bind(this), ...argv, INNER_CALL_SYMBOL);
                    quota -= 1;
                }


                return callParamResultMap.get(paramHash)!.promise;
            } catch (err) {
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
