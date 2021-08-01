"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serialOperation = void 0;
const defer_1 = require("../lib/defer");
const NOOP = () => undefined;
function serialOperation(id) {
    return function serialOperationDecorator(_target, _propName, propDesc) {
        const func = propDesc.value;
        if (typeof func !== 'function') {
            throw new Error('Invalid use of serial operation decorator');
        }
        async function serialOperationAwaredFunction(...argv) {
            const lastPromise = this[id];
            const deferred = defer_1.Defer();
            this[id] = deferred.promise;
            await lastPromise?.then(NOOP, NOOP);
            let result;
            try {
                result = await func.apply(this, argv);
                deferred.resolve(result);
            }
            catch (err) {
                deferred.reject(err);
            }
            return deferred.promise;
        }
        propDesc.value = serialOperationAwaredFunction;
        return propDesc;
    };
}
exports.serialOperation = serialOperation;
//# sourceMappingURL=serial-op.js.map