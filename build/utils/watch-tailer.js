"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileTailer = void 0;
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const events_1 = require("events");
const util_1 = require("util");
const indefinite_loop_1 = require("../decorators/indefinite-loop");
const iconv_lite_1 = require("iconv-lite");
const pStat = util_1.promisify(fs_1.default.stat);
const pRead = util_1.promisify(fs_1.default.read);
class FileTailer extends events_1.EventEmitter {
    constructor(path, options) {
        super();
        this.path = path;
        this.options = options;
        this.offset = 0;
        this.fReadBuf = Buffer.alloc(1024 * 4);
        this.textChunks = [];
        this._shutdown = false;
        pStat(path).then((r) => {
            this.istat = r;
            if (r.isFile()) {
                this.emit('exists', this.istat, true);
                return;
            }
            return Promise.reject(new Error('File required'));
        }).catch((err) => {
            this.emit('error', err);
        });
        this.on('exists', (fstat, firstTry) => {
            this.prepareFd(fstat, firstTry ? !Boolean(this.options?.fromStart) : false);
        });
        this.once('error', () => {
            this.close();
        });
        this.on('fd', (_fd) => {
            if (this.watcher) {
                this.watcher.close();
            }
            this.watcher = fs_1.default.watch(this.path, { encoding: this.options?.encoding });
            this.watcher.on('change', (event, _fileName) => {
                if (event === 'rename') {
                    pStat(path).then((r) => {
                        this.istat = r;
                        if (r.isFile()) {
                            this.emit('exists', this.istat);
                            return;
                        }
                        return Promise.reject(new Error('File disappeared'));
                    }).catch((err) => {
                        this.emit('removed', err);
                    });
                }
                else if (event === 'change') {
                    this.emit('changed');
                    this.drainFd().catch((err) => this.emit('removed', err));
                }
            });
            this.drainFd().catch(() => 0);
        });
        this.on('removed', () => {
            this.close().catch(() => 0);
        });
        this.on('chunk', (buf) => {
            if (this.decodeStream) {
                this.decodeStream.write(buf);
                return;
            }
            if (this.options?.encoding) {
                this.decodeStream = iconv_lite_1.decodeStream(this.options.encoding, {
                    stripBOM: true
                });
            }
            else {
                this.decodeStream = iconv_lite_1.decodeStream('utf-8', {
                    stripBOM: true
                });
            }
            this.decodeStream.on('data', (data) => {
                this.emit('text', data);
            });
            this.decodeStream.on('error', (err) => {
                this.emit('error', err);
            });
            this.decodeStream.write(buf);
        });
        this.once('end', () => {
            this._shutdown = true;
            if (this.decodeStream) {
                this.decodeStream.end();
            }
        });
        this.on('text', (text) => {
            const lines = [...this.textChunks, text].join('').split(/\r?\n/g);
            if (lines.length <= 1) {
                if (text) {
                    this.textChunks.push(text);
                }
                return;
            }
            this.textChunks.length = 0;
            const lastChunk = lines.pop();
            if (lastChunk) {
                this.textChunks.push(lastChunk);
            }
            lines.forEach((x) => {
                this.emit('line', x);
            });
        });
        if (process.platform === 'win32') {
            this.once('fd', () => {
                this.invokeAftershots(3000);
            });
            this.on('changed', () => {
                this.invokeAftershots();
                this.refreshClearAftershots(3000);
            });
            this.on('chunk', () => {
                this.invokeAftershots();
                this.refreshClearAftershots(3000);
            });
        }
    }
    async prepareFd(fstat, tailMode) {
        let inoChanged = false;
        if (fstat.ino !== this.inode) {
            inoChanged = true;
        }
        this.inode = fstat.ino;
        if (fstat.size < this.offset) {
            this.offset = 0;
        }
        if (!inoChanged) {
            return;
        }
        if (this.fd !== undefined) {
            const theFd = this.fd;
            try {
                await this.drainFd();
                this.fd = undefined;
            }
            catch (err) {
                this.emit('error', err);
            }
            fs_1.default.close(theFd, () => 0);
        }
        fs_1.default.open(this.path, 'r', (err, fd) => {
            if (err) {
                return this.emit('error', err);
            }
            this.fd = fd;
            this.offset = tailMode ? fstat.size : 0;
            this.emit('fd', fd);
            return;
        });
    }
    async drainFd() {
        if (this.fd === undefined) {
            if (this._shutdown) {
                return null;
            }
            throw new Error('Fd required');
        }
        let r = await pRead(this.fd, this.fReadBuf, 0, this.fReadBuf.byteLength, this.offset);
        if (r.bytesRead === 0) {
            const fstat = await pStat(this.path);
            if (fstat.size < this.offset) {
                this.offset = 0;
                r = await pRead(this.fd, this.fReadBuf, 0, this.fReadBuf.byteLength, this.offset);
            }
        }
        this.offset += r.bytesRead;
        if (r.bytesRead > 0) {
            this.emit('chunk', this.fReadBuf.slice(0, r.bytesRead));
        }
        if (r.bytesRead < this.fReadBuf.byteLength) {
            return null;
        }
        return r.bytesRead;
    }
    async close() {
        try {
            await this.drainFd();
        }
        catch (err) {
            void 0;
        }
        if (this.textChunks.length) {
            this.emit('line', this.textChunks.join(''));
        }
        if (this._aftershots) {
            clearInterval(this._aftershots);
        }
        if (this._clearAftershots) {
            clearInterval(this._clearAftershots);
        }
        this.emit('end');
        if (this.watcher) {
            this.watcher.close();
        }
        return new Promise((resolve, reject) => {
            if (this.fd) {
                const theFd = this.fd;
                this.fd = undefined;
                return fs_1.default.close(theFd, (err) => {
                    if (err) {
                        return reject(err);
                    }
                    return resolve();
                });
            }
            return resolve();
        });
    }
    invokeAftershots(interval) {
        const _interval = interval || 250;
        if (this._aftershots && this._aftershots._repeat === _interval) {
            return;
        }
        else if (this._aftershots) {
            clearInterval(this._aftershots);
        }
        this._aftershots = setInterval(() => {
            if (this._shutdown && this._aftershots) {
                clearInterval(this._aftershots);
                delete this._aftershots;
                return;
            }
            this.drainFd().catch(() => 0);
        }, _interval);
        this._aftershots.unref?.();
    }
    refreshClearAftershots(setToInterval) {
        if (this._clearAftershots) {
            clearTimeout(this._clearAftershots);
        }
        this._clearAftershots = setTimeout(() => {
            delete this._clearAftershots;
            if (this._aftershots) {
                clearInterval(this._aftershots);
                delete this._aftershots;
            }
            if (setToInterval && setToInterval > 0) {
                this.invokeAftershots(setToInterval);
            }
        }, 30000);
        this._clearAftershots.unref?.();
    }
}
tslib_1.__decorate([
    indefinite_loop_1.indefiniteLoop(1, null),
    tslib_1.__metadata("design:type", Function),
    tslib_1.__metadata("design:paramtypes", []),
    tslib_1.__metadata("design:returntype", Promise)
], FileTailer.prototype, "drainFd", null);
exports.FileTailer = FileTailer;
//# sourceMappingURL=watch-tailer.js.map