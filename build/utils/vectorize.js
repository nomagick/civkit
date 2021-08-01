"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deepCreate = exports.parseJSONText = exports.specialDeepVectorize = exports.vectorize = void 0;
const tslib_1 = require("tslib");
const lodash_1 = tslib_1.__importStar(require("lodash"));
function _vectorize(obj, stack = []) {
    const vectors = [];
    for (const x in obj) {
        if (obj.hasOwnProperty(x)) {
            const val = obj[x];
            if (val !== null && typeof val === 'object' && (Object.getPrototypeOf(val) === Object.prototype || Object.getPrototypeOf(val) === null)) {
                vectors.push(..._vectorize(val, stack.concat(x)));
            }
            else {
                vectors.push([stack.concat(x).join('.'), val]);
            }
        }
    }
    return vectors;
}
function vectorize(obj) {
    return lodash_1.default.fromPairs(_vectorize(obj));
}
exports.vectorize = vectorize;
function specialDeepVectorize(obj, stack = [], refStack = new Set()) {
    const vectors = [];
    if (!(obj && typeof obj.hasOwnProperty === 'function')) {
        return [];
    }
    if (obj instanceof Error) {
        Object.defineProperties(obj, {
            name: { enumerable: true },
            message: { enumerable: true },
        });
    }
    for (const x in obj) {
        let val;
        try {
            val = obj[x];
        }
        catch (err) {
            val = null;
        }
        if (refStack.has(val)) {
            vectors.push([stack.concat(x).join('.'), val]);
            continue;
        }
        refStack.add(val);
        if (val !== null && (typeof val === 'object' || typeof val === 'function')) {
            if (!lodash_1.isPlainObject(val) && !lodash_1.isArray(val) && !lodash_1.isArguments(val)) {
                vectors.push([stack.concat(x).join('.'), val]);
            }
            vectors.push(...specialDeepVectorize(val, stack.concat(x), refStack));
        }
        else {
            vectors.push([stack.concat(x).join('.'), val]);
        }
    }
    return vectors;
}
exports.specialDeepVectorize = specialDeepVectorize;
function parseJSONText(text) {
    if (!text) {
        return text;
    }
    try {
        return JSON.parse(text);
    }
    catch (err) {
        return text;
    }
}
exports.parseJSONText = parseJSONText;
function deepCreate(source) {
    if (Array.isArray(source)) {
        return source.map((x) => typeof x === 'object' ? deepCreate(x) : x);
    }
    const result = Object.create(source);
    for (const [k, v] of Object.entries(source)) {
        if (typeof v === 'object') {
            result[k] = deepCreate(v);
        }
    }
    return result;
}
exports.deepCreate = deepCreate;
//# sourceMappingURL=vectorize.js.map