"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.debounce = void 0;
function debounce(waitMs = 1000) {
    let lastRunAt = 0;
    return function debounceDecorator(_target, _propName, propDesc) {
        const func = propDesc.value;
        if (typeof func !== 'function') {
            throw new Error('Invalid use of debounce decorator');
        }
        let resultPromise;
        function newFunc(...argv) {
            if ((lastRunAt + waitMs) >= Date.now()) {
                return resultPromise;
            }
            lastRunAt = Date.now();
            resultPromise = new Promise((resolve, reject) => {
                setTimeout(() => {
                    try {
                        const r = func.apply(this, argv);
                        resolve(r);
                        return r;
                    }
                    catch (err) {
                        reject(err);
                    }
                }, waitMs);
            });
            return resultPromise;
        }
        propDesc.value = newFunc;
        return propDesc;
    };
}
exports.debounce = debounce;
//# sourceMappingURL=debounce.js.map