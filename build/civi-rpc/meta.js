"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractMeta = exports.assignMeta = exports.RPC_RESULT_META_SYMBOL = void 0;
const tslib_1 = require("tslib");
const lodash_1 = tslib_1.__importDefault(require("lodash"));
exports.RPC_RESULT_META_SYMBOL = Symbol('RPC result metas');
function assignMeta(target, meta) {
    const curMeta = target[exports.RPC_RESULT_META_SYMBOL];
    if (!curMeta) {
        target[exports.RPC_RESULT_META_SYMBOL] = meta;
        return target;
    }
    lodash_1.default.merge(curMeta, meta);
    return target;
}
exports.assignMeta = assignMeta;
function extractMeta(target) {
    if (typeof target !== 'object' || !target) {
        return;
    }
    return target[exports.RPC_RESULT_META_SYMBOL];
}
exports.extractMeta = extractMeta;
//# sourceMappingURL=meta.js.map