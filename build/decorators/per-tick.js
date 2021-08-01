"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.perNextTick = exports.perTick = void 0;
const NOT_RUN = Symbol('NOT RUN');
const tickFunction = process?.nextTick || setImmediate || setTimeout;
function perTick() {
    return function perTickDecorator(_target, _propName, propDesc) {
        const func = propDesc.value;
        if (typeof func !== 'function') {
            throw new Error('Invalid use of perTick decorator');
        }
        let tickActive = false;
        let lastResult = NOT_RUN;
        let lastThrown = NOT_RUN;
        function newFunc(...argv) {
            if (tickActive) {
                if (lastThrown !== NOT_RUN) {
                    throw lastThrown;
                }
                return lastResult;
            }
            tickActive = true;
            tickFunction(() => tickActive = false);
            try {
                lastResult = func.apply(this, argv);
                return lastResult;
            }
            catch (err) {
                lastThrown = err;
                throw err;
            }
        }
        propDesc.value = newFunc;
        return propDesc;
    };
}
exports.perTick = perTick;
function perNextTick() {
    return function perTickDecorator(_target, _propName, propDesc) {
        const func = propDesc.value;
        if (typeof func !== 'function') {
            throw new Error('Invalid use of perNextTick decorator');
        }
        let tickActive = false;
        function newFunc(...argv) {
            if (tickActive) {
                return;
            }
            tickActive = true;
            tickFunction(() => {
                tickActive = false;
                try {
                    func.apply(this, argv);
                }
                catch (err) {
                    throw err;
                }
            });
        }
        propDesc.value = newFunc;
        return propDesc;
    };
}
exports.perNextTick = perNextTick;
//# sourceMappingURL=per-tick.js.map