"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeWithHintEncoding = exports.decode = exports.detectEncoding = void 0;
const tslib_1 = require("tslib");
const jschardet_1 = tslib_1.__importDefault(require("jschardet"));
const iconv_lite_1 = tslib_1.__importDefault(require("iconv-lite"));
function detectEncoding(buf) {
    const result = jschardet_1.default.detect(buf);
    if (result.confidence >= 0.90) {
        return result.encoding;
    }
    return undefined;
}
exports.detectEncoding = detectEncoding;
function decode(buf, encoding) {
    if (encoding && (typeof encoding === 'string')) {
        if (!iconv_lite_1.default.encodingExists(encoding)) {
            throw new Error(`Unsupported encoding: ${encoding}`);
        }
        return iconv_lite_1.default.decode(buf, encoding);
    }
    return decode(buf, detectEncoding(buf) || 'utf-8');
}
exports.decode = decode;
function decodeWithHintEncoding(buf, hintEncoding) {
    return decode(buf, detectEncoding(buf) || hintEncoding);
}
exports.decodeWithHintEncoding = decodeWithHintEncoding;
//# sourceMappingURL=encoding.js.map