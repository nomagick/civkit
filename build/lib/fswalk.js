"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BFsWalk = void 0;
const tslib_1 = require("tslib");
const events_1 = require("events");
const pathModule = tslib_1.__importStar(require("path"));
const fs_1 = require("fs");
const encoding_1 = require("./encoding");
const throttle_1 = require("./throttle");
const lodash_1 = tslib_1.__importDefault(require("lodash"));
const bSep = Buffer.from(pathModule.sep);
const presumedFsEncoding = process.platform === 'win32' ? 'cp936' : 'utf-8';
class BFsWalk extends events_1.EventEmitter {
    constructor(fpath, _options = {}) {
        super();
        this._kInstances = 0;
        const options = lodash_1.default.defaults(_options, {
            throttle: 10,
            symlinkDepth: 30,
            followSymlink: false,
            autoDecode: 'utf-8',
            depthFirst: true,
            rootPrefix: ''
        });
        this.rootPrefix = Buffer.from(options.rootPrefix);
        this.origPath = Buffer.from(fpath);
        this.followSymink = Boolean(options.followSymlink);
        this.autoDecode = options.autoDecode ? options.autoDecode : false;
        this.throttle = new throttle_1.PromiseThrottle(parseInt(options.throttle));
        this.symlinkDepth = parseInt(options.symlinkDepth);
        this.depthFirst = Boolean(options.depthFirst);
    }
    static walk(fpath, options) {
        const ins = new this(fpath, options);
        ins.bwalk();
        return ins;
    }
    static walkOut(fpath, options) {
        return new Promise((resolve, reject) => {
            const entries = [];
            const ins = new this(fpath, options);
            ins.on('end', () => {
                resolve(entries);
            });
            ins.on('error', (err) => {
                reject(err);
            });
            ins.on('file', (file) => {
                entries.push(Object.assign({ type: 'file' }, file));
            });
            ins.on('dir', (dir) => {
                entries.push(Object.assign({ type: 'dir' }, dir));
            });
            ins.bwalk().catch((err) => {
                reject(err);
            });
        });
    }
    async bwalk(thePath = this.origPath, relativePathStack = [this.rootPrefix], symlinkDepth = this.symlinkDepth) {
        this._kInstances += 1;
        let acquiredResource = await this.throttle.acquire();
        const absPath = thePath === this.origPath ? await fs_1.promises.realpath(thePath, 'buffer') : thePath;
        const curStat = await fs_1.promises.lstat(absPath);
        const result = {
            stats: curStat
        };
        if (this.autoDecode) {
            if (typeof this.autoDecode === 'string' && this.autoDecode != 'auto') {
                result.path = encoding_1.decodeWithHintEncoding(absPath, this.autoDecode);
                const rPathVecs = lodash_1.default.compact(relativePathStack.map((x) => encoding_1.decodeWithHintEncoding(x, this.autoDecode)));
                result.relativePath = rPathVecs.length ? pathModule.join(...rPathVecs) : '';
            }
            else {
                result.path = encoding_1.decodeWithHintEncoding(absPath, presumedFsEncoding);
                const rPathVecs = lodash_1.default.compact(relativePathStack.map((x) => encoding_1.decodeWithHintEncoding(x, this.autoDecode)));
                result.relativePath = rPathVecs.length ? pathModule.join(...rPathVecs) : '';
            }
        }
        else {
            result.path = absPath;
            result.relativePath = Buffer.concat([...(relativePathStack.slice(0, -1).map((x) => Buffer.concat([x, bSep]))), relativePathStack[relativePathStack.length - 1]]);
        }
        if (curStat.isFile()) {
            this.emit('file', result);
        }
        else if (curStat.isDirectory()) {
            this.emit('dir', result);
            const fList = await fs_1.promises.readdir(absPath, 'buffer');
            if (this.depthFirst && acquiredResource) {
                acquiredResource.release();
                acquiredResource = null;
            }
            for (const fName of fList) {
                const p = this.bwalk(Buffer.concat([absPath, bSep, fName]), [...relativePathStack, fName], symlinkDepth);
                if (this.depthFirst) {
                    await p;
                }
                else {
                    p.catch((err) => {
                        this.emit('error', err);
                    });
                }
            }
        }
        else if (curStat.isSymbolicLink()) {
            this.emit('symlink', result);
            if (this.followSymink && symlinkDepth > 0) {
                const linkContent = await fs_1.promises.readlink(absPath, 'buffer');
                let theOtherEnd;
                let linkContentString;
                if (this.autoDecode && typeof this.autoDecode === 'string' && this.autoDecode != 'auto') {
                    linkContentString = encoding_1.decodeWithHintEncoding(linkContent, this.autoDecode);
                }
                else {
                    linkContentString = encoding_1.decodeWithHintEncoding(linkContent, presumedFsEncoding);
                }
                if (pathModule.isAbsolute(linkContentString)) {
                    theOtherEnd = linkContent;
                }
                else {
                    theOtherEnd = await fs_1.promises.realpath(Buffer.concat([absPath, bSep, linkContent]), 'buffer');
                }
                if (this.depthFirst && acquiredResource) {
                    acquiredResource.release();
                    acquiredResource = null;
                }
                const p = this.bwalk(theOtherEnd, relativePathStack, symlinkDepth - 1);
                if (this.depthFirst) {
                    await p;
                }
                else {
                    p.catch((err) => {
                        this.emit('error', err);
                    });
                }
            }
        }
        else {
            this.emit('other', result);
        }
        this._kInstances -= 1;
        if (acquiredResource) {
            acquiredResource.release();
        }
        if (this._kInstances === 0) {
            this.emit('end');
        }
        return;
    }
}
exports.BFsWalk = BFsWalk;
//# sourceMappingURL=fswalk.js.map