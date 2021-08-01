"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDateUTC = exports.chainEntries = exports.chainKeys = exports.isConstructor = void 0;
function isConstructor(f) {
    try {
        Reflect.construct(String, [], f);
    }
    catch (e) {
        return false;
    }
    return true;
}
exports.isConstructor = isConstructor;
function chainKeys(o) {
    const keySet = new Set();
    let ptr = o;
    while (ptr) {
        for (const x of Object.keys(ptr)) {
            keySet.add(x);
        }
        ptr = Object.getPrototypeOf(ptr);
    }
    return Array.from(keySet);
}
exports.chainKeys = chainKeys;
function chainEntries(o) {
    return chainKeys(o).map((x) => [x, o[x]]);
}
exports.chainEntries = chainEntries;
function formatDateUTC(date) {
    return `${date.getUTCFullYear()}${(date.getUTCMonth() + 1).toString().padStart(2, '0')}${date.getUTCDate().toString().padStart(2, '0')}`;
}
exports.formatDateUTC = formatDateUTC;
//# sourceMappingURL=lang.js.map