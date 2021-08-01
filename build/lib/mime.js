"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseContentType = exports.restoreContentType = exports.mimeOf = exports.detectBuff = exports.detectFile = exports.extOfMime = exports.mimeOfExt = exports.mimeTypeCompatible = exports.CUSTOM_MIME = void 0;
const tslib_1 = require("tslib");
const file_type_1 = tslib_1.__importDefault(require("file-type"));
const mime_1 = tslib_1.__importDefault(require("mime"));
const lodash_1 = tslib_1.__importDefault(require("lodash"));
exports.CUSTOM_MIME = {};
mime_1.default.define(exports.CUSTOM_MIME);
function mimeTypeCompatible(thisMimeType, thatMimeType, sharedExt) {
    if (thisMimeType === thatMimeType) {
        return true;
    }
    const thisExts = mime_1.default._types[thisMimeType];
    const thatExts = mime_1.default._types[thatMimeType];
    const intersection = lodash_1.default.intersection(thisExts, thatExts);
    if (intersection.length === 0) {
        return false;
    }
    if (sharedExt) {
        if (intersection.indexOf(sharedExt) >= 0) {
            return true;
        }
        else {
            return false;
        }
    }
    else {
        return false;
    }
}
exports.mimeTypeCompatible = mimeTypeCompatible;
function mimeOfExt(ext) {
    return mime_1.default.getType(ext);
}
exports.mimeOfExt = mimeOfExt;
function extOfMime(mimeType) {
    return mime_1.default.getExtension(mimeType);
}
exports.extOfMime = extOfMime;
function detectFile(path) {
    return file_type_1.default.fromFile(path);
}
exports.detectFile = detectFile;
function detectBuff(buff) {
    return file_type_1.default.fromBuffer(buff);
}
exports.detectBuff = detectBuff;
async function mimeOf(data) {
    let result;
    if (typeof data === 'string') {
        result = await detectFile(data);
    }
    else {
        result = await detectBuff(data);
    }
    const vec = parseContentType(result?.mime || 'application/octet-stream');
    if (!vec) {
        throw new Error('Unable to detect mime');
    }
    return vec;
}
exports.mimeOf = mimeOf;
const CONTENT_TYPE_RE = /^((?:[0-9A-Za-z]+)|\*)\/(\*|(?:\b[0-9A-Za-z\-_]+(?:\-?\b[0-9A-Za-z\-_]+\b)*(?:\.\b[0-9A-Za-z\-_]+\b(?:\-\b[0-9A-Za-z\-_]+\b)*)*))(?:\+?(\b[0-9A-Za-z\-_\.]+\b))?(?:;\s*(.*?))?$/;
function restoreContentType(mimeVec) {
    if (!mimeVec) {
        return '';
    }
    let attrsLiteral = '';
    if (mimeVec.attrs) {
        for (const [k, v] of Object.entries(mimeVec.attrs)) {
            attrsLiteral += `; ${k}=${v}`;
        }
    }
    return `${mimeVec.mediaType || 'application'}/${mimeVec.subType || 'octet-stream'}` +
        `${mimeVec.suffix ? '+' + mimeVec.suffix : ''}` +
        `${attrsLiteral}`;
}
exports.restoreContentType = restoreContentType;
function parseContentType(mimeStr) {
    const r = CONTENT_TYPE_RE.exec(mimeStr);
    if (!r) {
        return null;
    }
    const [, mediaType, subType, suffix, typeParamText] = r;
    const attrs = {};
    if (typeParamText) {
        const paramVecs = typeParamText.split(/\s*;\s*/);
        for (const vec of paramVecs) {
            if (!vec) {
                continue;
            }
            const [k, _v] = vec.split(/\s*=\s*/);
            const v = lodash_1.default.trim(_v, '" \t\n');
            if (k && v) {
                attrs[k.toLowerCase()] = v;
            }
        }
    }
    return { mediaType: mediaType.toLowerCase(), subType: subType.toLowerCase(), suffix: suffix ? suffix.toLowerCase() : suffix, attrs };
}
exports.parseContentType = parseContentType;
//# sourceMappingURL=mime.js.map