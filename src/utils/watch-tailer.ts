import fs from 'fs';
import { EventEmitter } from 'events';
import { promisify } from 'util';
import { indefiniteLoop } from '../decorators/indefinite-loop';
import { decodeStream } from 'iconv-lite';
// import { detectEncoding } from '../lib/encoding';

const pStat = promisify(fs.stat);
const pRead = promisify(fs.read);

export class FileTailer extends EventEmitter {

    istat?: fs.Stats;
    fd?: number;
    inode?: number;
    offset: number = 0;

    watcher?: fs.FSWatcher;

    fReadBuf = Buffer.alloc(1024 * 4);

    decodeStream?: NodeJS.ReadWriteStream;

    textChunks: string[] = [];

    _shutdown: boolean = false;
    _aftershots?: ReturnType<typeof setTimeout>;
    _clearAftershots?: ReturnType<typeof setTimeout>;

    constructor(public path: string, private options?: { encoding?: BufferEncoding; fromStart?: boolean }) {
        super();
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

        this.on('exists', (fstat: fs.Stats, firstTry?: boolean) => {
            this.prepareFd(fstat, firstTry ? !Boolean(this.options?.fromStart) : false);
        });

        this.once('error', () => {
            this.close();
        });

        this.on('fd', (_fd) => {

            if (this.watcher) {
                this.watcher.close();
            }

            this.watcher = fs.watch(this.path, { encoding: this.options?.encoding });

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
                } else if (event === 'change') {
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
                this.decodeStream = decodeStream(this.options.encoding, {
                    stripBOM: true
                });
            } else {
                this.decodeStream = decodeStream('utf-8', {
                    stripBOM: true
                });
            }

            this.decodeStream.on('data', (data) => {
                this.emit('text', data);
            });

            this.decodeStream.on('error', (err) => {
                this.emit('error', err);
            });

            this.decodeStream!.write(buf);
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
            // Windows sucks.
            // Windows not emitting fs change even if file changed.

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

    async prepareFd(fstat: fs.Stats, tailMode: boolean) {
        let inoChanged = false;
        if (fstat.ino !== this.inode) {
            inoChanged = true;
        }
        this.inode = fstat.ino;

        if (fstat.size < this.offset) {
            // truncation, start from the start;
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
            } catch (err) {
                this.emit('error', err);
            }

            fs.close(theFd, () => 0);
        }

        fs.open(this.path, 'r', (err, fd) => {
            if (err) {
                return this.emit('error', err);
            }
            this.fd = fd;
            this.offset = tailMode ? fstat.size : 0;
            this.emit('fd', fd);

            return;
        });
    }


    @indefiniteLoop(1, null)
    async drainFd(): Promise<void> {
        if (this.fd === undefined) {
            if (this._shutdown) {
                return null as any;
            }

            throw new Error('Fd required');
        }
        let r = await pRead(this.fd, this.fReadBuf, 0, this.fReadBuf.byteLength, this.offset);

        if (r.bytesRead === 0) {
            const fstat = await pStat(this.path);
            if (fstat.size < this.offset) {
                // truncation
                this.offset = 0;
                r = await pRead(this.fd, this.fReadBuf, 0, this.fReadBuf.byteLength, this.offset);
            }
        }

        this.offset += r.bytesRead;
        if (r.bytesRead > 0) {
            this.emit('chunk', this.fReadBuf.slice(0, r.bytesRead));
        }

        if (r.bytesRead < this.fReadBuf.byteLength) {
            // drain, return null so the indefiniteloop decorator stops looping;
            return null as any;
        }

        // return value not null so the indefiniteloop decorator keeps looping;
        return r.bytesRead as any;
    }


    async close() {
        try {
            await this.drainFd();
        } catch (err) {
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

        return new Promise<void>((resolve, reject) => {
            if (this.fd) {
                const theFd = this.fd;
                this.fd = undefined;

                return fs.close(theFd, (err) => {
                    if (err) {
                        return reject(err);
                    }

                    return resolve();
                });
            }

            return resolve();
        });
    }

    invokeAftershots(interval?: number) {
        const _interval = interval || 250;
        if (this._aftershots && (this._aftershots as any)._repeat === _interval) {
            return;
        } else if (this._aftershots) {
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

    refreshClearAftershots(setToInterval?: number) {
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

