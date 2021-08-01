"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FancyFile = exports.ResolvedFile = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const defer_1 = require("./defer");
const hash_1 = require("./hash");
const mime_1 = require("./mime");
const PEEK_BUFFER_SIZE = 32 * 1024;
const sha256Hasher = new hash_1.HashManager('sha256', 'hex');
class ResolvedFile {
    createReadStream() {
        const fpath = this.filePath;
        return fs_1.createReadStream(fpath);
    }
    async unlink() {
        const fpath = this.filePath;
        return new Promise((resolve, reject) => {
            fs_1.unlink(fpath, (err) => {
                if (err) {
                    return reject(err);
                }
                return resolve(err);
            });
        });
    }
}
exports.ResolvedFile = ResolvedFile;
class FancyFile {
    constructor() {
        this._notSupposedToUnlink = false;
        this._deferreds = new Map();
    }
    static _fromLocalFile(filePath, partialFile = {}) {
        if (!(filePath && typeof filePath === 'string')) {
            throw new Error('Auto fancy file requires a file path string.');
        }
        const fileInstance = new this();
        fileInstance._notSupposedToUnlink = true;
        fs_1.stat(filePath, (err, fstat) => {
            if (err) {
                return fileInstance._rejectAll(err);
            }
            fileInstance.fstat = fstat;
            fileInstance.size = partialFile.size || fstat.size;
            fileInstance.fileName = partialFile.fileName || (path_1.basename(filePath) + path_1.extname(filePath));
            fileInstance.filePath = filePath;
        });
        if (partialFile.sha256Sum) {
            fileInstance.sha256Sum = partialFile.sha256Sum;
        }
        if (partialFile.mimeVec) {
            fileInstance.mimeVec = partialFile.mimeVec;
        }
        else if (partialFile.mimeType) {
            fileInstance.mimeVec = mime_1.parseContentType(partialFile.mimeType);
        }
        return fileInstance;
    }
    static _fromStream(readable, tmpFilePath, partialFile = {}) {
        if (!(readable && typeof readable.pipe === 'function' && typeof readable.on === 'function')) {
            throw new Error('Auto fancy file from stream requires a file stream.');
        }
        const tmpTargetStream = fs_1.createWriteStream(tmpFilePath);
        const fileInstance = new this();
        const peekBuffers = [];
        let sizeAcc = 0;
        readable.pause();
        fileInstance.fileName = partialFile.fileName || (path_1.basename(tmpFilePath) + path_1.extname(tmpFilePath));
        if (partialFile.mimeVec) {
            fileInstance.mimeVec = partialFile.mimeVec;
        }
        else if (partialFile.mimeType) {
            fileInstance.mimeVec = mime_1.parseContentType(partialFile.mimeType);
        }
        else {
            readable.once('__peek', () => {
                mime_1.mimeOf(Buffer.concat(peekBuffers)).then((mimeVec) => {
                    fileInstance.mimeVec = mimeVec;
                }).catch((err) => {
                    fileInstance._rejectAll(err, ['mimeType', 'mimeVec']);
                });
            });
            const peekDataListener = (data) => {
                peekBuffers.push(data);
                if (sizeAcc >= PEEK_BUFFER_SIZE) {
                    readable.removeListener('data', peekDataListener);
                    readable.emit('__peek');
                }
            };
            readable.on('data', peekDataListener);
        }
        readable.on('data', (data) => {
            sizeAcc += data.byteLength;
        });
        readable.once('end', () => {
            readable.emit('__peek');
            if (!partialFile.size) {
                fileInstance.size = sizeAcc;
            }
        });
        if (partialFile.size) {
            fileInstance.size = partialFile.size;
        }
        fileInstance.sha256Sum = partialFile.sha256Sum || sha256Hasher.hashStream(readable);
        readable.on('error', (err) => fileInstance._rejectAll(err));
        tmpTargetStream.on('error', (err) => fileInstance._rejectAll(err));
        readable.pipe(tmpTargetStream);
        tmpTargetStream.once('finish', () => {
            fileInstance.filePath = tmpFilePath;
        });
        readable.resume();
        return fileInstance;
    }
    static _fromBuffer(buff, tmpFilePath, partialFile = {}) {
        if (!buff || !((buff instanceof Buffer))) {
            throw new Error('Memory fancy file requires a buffer.');
        }
        const fileInstance = new this();
        if (partialFile.mimeVec) {
            fileInstance.mimeVec = partialFile.mimeVec;
        }
        else if (partialFile.mimeType) {
            fileInstance.mimeVec = mime_1.parseContentType(partialFile.mimeType);
        }
        else {
            mime_1.mimeOf(buff.slice(0, PEEK_BUFFER_SIZE)).then((mimeVec) => {
                fileInstance.mimeVec = mimeVec;
            }).catch((err) => {
                fileInstance._rejectAll(err, ['mimeType', 'mimeVec']);
            });
        }
        fileInstance.size = partialFile.size || buff.byteLength;
        fileInstance.fileName = partialFile.fileName || (path_1.basename(tmpFilePath) + path_1.extname(tmpFilePath));
        fileInstance.sha256Sum = partialFile.sha256Sum || sha256Hasher.hash(buff);
        fileInstance.filePath = new Promise((resolve, reject) => {
            fs_1.open(tmpFilePath, 'w', (err, fd) => {
                if (err) {
                    return reject(err);
                }
                fs_1.write(fd, buff, (err2, _writen) => {
                    if (err2) {
                        return reject(err);
                    }
                    fs_1.close(fd, (err3) => {
                        if (err3) {
                            return reject(err);
                        }
                        resolve(tmpFilePath);
                    });
                });
            });
        });
        return fileInstance;
    }
    static auto(a, b, c) {
        if (!a) {
            throw new Error('Unreconized Input. No Idea What To Do.');
        }
        if (typeof a === 'string') {
            return this._fromLocalFile(a, b);
        }
        else if (a.filePath) {
            return this._fromLocalFile(a.filePath, a);
        }
        else if (a instanceof Buffer) {
            return this._fromBuffer(a, b, c);
        }
        else if (a.fileBuffer) {
            return this._fromBuffer(a.fileBuffer, b, a);
        }
        else if (typeof a.pipe === 'function') {
            return this._fromStream(a, b, c);
        }
        else if (a.fileStream) {
            return this._fromStream(a.fileStream, b, a);
        }
        throw new Error('Unreconized Input. No Idea What To Do.');
    }
    _ensureDeferred(key) {
        if (!this._deferreds.get(key)) {
            const val = defer_1.Defer();
            this._deferreds.set(key, val);
            const subval = Object.create(val);
            subval.isNew = true;
            return subval;
        }
        return this._deferreds.get(key);
    }
    _resolveDeferred(key, value) {
        const deferred = this._ensureDeferred(key);
        deferred.resolve(value);
        return deferred.promise;
    }
    _rejectDeferred(key, err) {
        const deferred = this._ensureDeferred(key);
        deferred.promise.catch(() => 0);
        deferred.reject(err);
        return deferred.promise;
    }
    _rejectAll(err, keys = FancyFile._keys) {
        for (const x of keys) {
            this._rejectDeferred(x, err);
        }
    }
    get mimeType() {
        const deferred = this._ensureDeferred('mimeType');
        if (deferred.isNew) {
            this.filePath.then(mime_1.mimeOf).then((mimeVec) => {
                this.mimeVec = mimeVec;
            }).catch((err) => {
                this._rejectAll(err, ['mimeVec', 'mimeType']);
            });
        }
        return deferred.promise;
    }
    get mimeVec() {
        const deferred = this._ensureDeferred('mimeVec');
        if (deferred.isNew) {
            this.filePath.then(mime_1.mimeOf).then((mimeVec) => {
                this.mimeVec = mimeVec;
            }).catch((err) => {
                this._rejectAll(err, ['mimeVec', 'mimeType']);
            });
        }
        return deferred.promise;
    }
    set mimeVec(_mimeVec) {
        let mimeVec = _mimeVec;
        if (typeof _mimeVec === 'string') {
            mimeVec = mime_1.parseContentType(_mimeVec);
        }
        const r = this._resolveDeferred('mimeVec', mimeVec);
        r.then((mimeVec) => {
            if (mimeVec) {
                this._resolveDeferred('mimeType', `${mimeVec.mediaType || 'application'}/${mimeVec.subType || 'octet-stream'}${mimeVec.suffix ? '+' + mimeVec.suffix : ''}`);
            }
            else {
                this._resolveDeferred('mimeType', 'application/octet-stream');
            }
        });
    }
    get fileName() {
        return this._ensureDeferred('fileName').promise;
    }
    set fileName(fileNameText) {
        this._resolveDeferred('fileName', fileNameText);
    }
    get size() {
        return this._ensureDeferred('size').promise;
    }
    set size(sizeNumber) {
        this._resolveDeferred('size', sizeNumber);
    }
    get sha256Sum() {
        const deferred = this._ensureDeferred('sha256Sum');
        if (deferred.isNew) {
            this.filePath
                .then(fs_1.createReadStream)
                .then((x) => sha256Hasher.hashStream(x))
                .then((x) => this.sha256Sum = x)
                .catch((err) => {
                this._rejectDeferred('sha256Sum', err);
            });
        }
        return deferred.promise;
    }
    set sha256Sum(sha256SumText) {
        this._resolveDeferred('sha256Sum', sha256SumText);
    }
    get filePath() {
        return this._ensureDeferred('filePath').promise;
    }
    set filePath(filePathText) {
        this._resolveDeferred('filePath', filePathText);
    }
    get all() {
        return this.resolve();
    }
    get ready() {
        return this.filePath;
    }
    resolve() {
        if (!this._all) {
            this._all = Promise.all([
                this.mimeType, this.mimeVec,
                this.fileName, this.size, this.sha256Sum, this.filePath
            ])
                .then((vec) => {
                const [mimeType, mimeVec, fileName, size, sha256Sum, filePath] = vec;
                const resolvedFile = new ResolvedFile();
                Object.assign(resolvedFile, { mimeType, mimeVec, fileName, size, sha256Sum, filePath });
                return resolvedFile;
            });
        }
        return this._all;
    }
    async createReadStream(options) {
        const fpath = await this.filePath;
        return fs_1.createReadStream(fpath, options);
    }
    async unlink(forced = false) {
        if (this._notSupposedToUnlink && !forced) {
            return Promise.resolve();
        }
        const fpath = await this.filePath;
        return new Promise((resolve, reject) => {
            fs_1.unlink(fpath, (err) => {
                if (err) {
                    return reject(err);
                }
                return resolve();
            });
        });
    }
}
exports.FancyFile = FancyFile;
FancyFile._keys = ['mimeType', 'mimeVec', 'fileName', 'filePath', 'sha256Sum', 'size'];
//# sourceMappingURL=fancy-file.js.map