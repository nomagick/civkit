"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOnce = void 0;
const NOT_RUN = Symbol('NOT RUN');
function runOnce() {
    return function runOnceDecorator(_target, _propName, propDesc) {
        const func = propDesc.value;
        if (typeof func !== 'function') {
            throw new Error('Invalid use of runOnce decorator');
        }
        let result = NOT_RUN;
        let thrown = NOT_RUN;
        function newFunc(...argv) {
            if (thrown !== NOT_RUN) {
                throw thrown;
            }
            if (result !== NOT_RUN) {
                return result;
            }
            try {
                result = func.apply(this, argv);
                return result;
            }
            catch (err) {
                thrown = err;
                throw err;
            }
        }
        propDesc.value = newFunc;
        return propDesc;
    };
}
exports.runOnce = runOnce;
//# sourceMappingURL=once.js.map