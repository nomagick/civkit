"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.systemPathToUrl = exports.urlPathToSystemPath = void 0;
const sep = process.platform === 'win32' ? '\\' : '/';
const sepReg = /[\\/]/gi;
function urlPathToSystemPath(fpath) {
    const pathVec = decodeURI(fpath).split('/').filter((x) => Boolean(x)).join(sep);
    return process.platform === 'win32' ? pathVec : `/${pathVec}`;
}
exports.urlPathToSystemPath = urlPathToSystemPath;
function systemPathToUrl(fpath, proto = 'file') {
    if (fpath.startsWith('\\\\')) {
        const theUrl = new URL(`${proto}://${fpath.replace(/^\\\\/gi, '').split(sepReg).filter((x) => Boolean(x)).join('/')}`);
        return theUrl.toString();
    }
    const pathVec = fpath.split(sepReg).filter((x) => Boolean(x)).join('/');
    const urlVec = new URL(`${proto}:///${pathVec}`);
    return urlVec.toString();
}
exports.systemPathToUrl = systemPathToUrl;
//# sourceMappingURL=path.js.map