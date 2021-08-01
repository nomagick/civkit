"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.throttle = void 0;
function throttle(cap = 1) {
    let s = 0;
    return function throttleDecorator(_target, _propName, propDesc) {
        const func = propDesc.value;
        if (typeof func !== 'function') {
            throw new Error('Invalid use of throttle decorator');
        }
        let lastPromise;
        function newFunc(...argv) {
            if (s >= cap) {
                return lastPromise;
            }
            s += 1;
            try {
                const r = func.apply(this, argv);
                if (r.then && ((typeof r.then) === 'function')) {
                    r.then(() => s -= 1, () => s -= 1);
                    lastPromise = r;
                }
                else {
                    s -= 1;
                }
                return r;
            }
            catch (err) {
                s -= 1;
                throw err;
            }
        }
        propDesc.value = newFunc;
        return propDesc;
    };
}
exports.throttle = throttle;
//# sourceMappingURL=throttle.js.map