"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.awaitObj = exports.safeAwaitObj = exports.defuseObj = exports.defuse = void 0;
const lodash_1 = require("lodash");
function defuse(promise) {
    return new Promise((resolve, _reject) => {
        promise.then(resolve, () => resolve(null));
    });
}
exports.defuse = defuse;
function defuseObj(obj) {
    return lodash_1.mapValues(obj, (x) => {
        if (x && typeof x.catch === 'function') {
            return x.catch(() => null);
        }
        return x;
    });
}
exports.defuseObj = defuseObj;
async function safeAwaitObj(obj) {
    const defused = defuseObj(obj);
    return lodash_1.fromPairs(await Promise.all(lodash_1.toPairs(defused).map(async ([k, v]) => [k, await v])));
}
exports.safeAwaitObj = safeAwaitObj;
async function awaitObj(obj) {
    return lodash_1.fromPairs(await Promise.all(lodash_1.toPairs(obj).map(async ([k, v]) => [k, await v])));
}
exports.awaitObj = awaitObj;
//# sourceMappingURL=defuse.js.map