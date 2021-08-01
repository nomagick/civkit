"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemporaryFileManger = void 0;
const tslib_1 = require("tslib");
const uuid_1 = require("uuid");
const fs_1 = tslib_1.__importDefault(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const fs_extra_1 = tslib_1.__importDefault(require("fs-extra"));
const fancy_file_1 = require("./fancy-file");
class TemporaryFileManger {
    constructor(rootDir) {
        if (rootDir) {
            try {
                const fstat = fs_1.default.statSync(rootDir);
                if (!fstat.isDirectory) {
                    throw new Error('TmpFile targert dir was not a dir: ' + rootDir);
                }
            }
            catch (err) {
                if (err.code === 'ENOENT') {
                    fs_1.default.mkdirSync(rootDir);
                    this.rootDir = rootDir;
                    return;
                }
                throw new Error('Error stating tmpfile target dir: ' + rootDir);
            }
            this.rootDir = rootDir;
        }
        else {
            this.rootDir = fs_1.default.mkdtempSync('nodejs-application-');
        }
    }
    fullPath(fileName) {
        return path_1.default.join(this.rootDir, fileName || this.newName());
    }
    newName() {
        return uuid_1.v1();
    }
    touch() {
        const newFileName = this.newName();
        return [newFileName, this.touchWithFileName(newFileName)];
    }
    touchWithFileName(fileName) {
        return new Promise((resolve, reject) => {
            fs_1.default.open(path_1.default.join(this.rootDir, fileName), 'w+', (err, fd) => {
                if (err) {
                    return reject(err);
                }
                resolve(fd);
            });
        });
    }
    alloc() {
        return this.fullPath();
    }
    async newWritableStream(fileName) {
        let fd;
        let _fileName = fileName;
        if (_fileName) {
            fd = await this.touchWithFileName(_fileName);
        }
        else {
            let fdPromise;
            [_fileName, fdPromise] = this.touch();
            fd = await fdPromise;
        }
        const fpath = path_1.default.join(this.rootDir, _fileName);
        return [_fileName, fs_1.default.createWriteStream(fpath, { fd, flags: 'w' }), fpath];
    }
    getReadableStream(fileName) {
        return fs_1.default.createReadStream(path_1.default.join(this.rootDir, fileName));
    }
    remove(fileName) {
        return new Promise((resolve, reject) => {
            fs_1.default.unlink(path_1.default.join(this.rootDir, fileName), (err) => {
                if (err) {
                    return reject(err);
                }
                return resolve();
            });
        });
    }
    cacheReadable(readable, fileName) {
        const tmpFilePath = this.fullPath();
        return fancy_file_1.FancyFile.auto(readable, tmpFilePath, { fileName });
    }
    cacheBuffer(buff, fileName) {
        const tmpFilePath = this.fullPath();
        return fancy_file_1.FancyFile.auto(buff, tmpFilePath, { fileName });
    }
    cacheText(str, fileName) {
        return this.cacheBuffer(Buffer.from(str), fileName);
    }
    access(fileName) {
        return fancy_file_1.FancyFile.auto(this.fullPath(fileName));
    }
    mkdir(dirName) {
        const fullPath = path_1.default.join(this.rootDir, dirName);
        return new Promise((resolve, reject) => {
            fs_1.default.mkdir(fullPath, (err) => {
                if (err) {
                    return reject(err);
                }
                resolve(fullPath);
            });
        });
    }
    touchDir() {
        const newName = this.newName();
        return [newName, this.mkdir(newName)];
    }
    rmdir(dirName) {
        if (path_1.default.isAbsolute(dirName)) {
            return fs_extra_1.default.remove(dirName);
        }
        else {
            return fs_extra_1.default.remove(path_1.default.join(this.rootDir, dirName));
        }
    }
}
exports.TemporaryFileManger = TemporaryFileManger;
//# sourceMappingURL=tmp-file.js.map