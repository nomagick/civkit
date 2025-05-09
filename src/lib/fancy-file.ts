import { Readable } from 'stream';
import fs, { promises as fsp } from 'fs';
import { basename } from 'path';

import { Defer, Deferred } from './defer';
import { HashManager } from './hash';
import { mimeOf, MIMEVec, parseContentType, restoreContentType } from './mime';
import { Also, AutoConstructor } from './auto-castable';
import {
    TransferProtocolMetadata, RPC_TRANSFER_PROTOCOL_META_SYMBOL,
    transferProtocolMetaDecorated,
    TPM
} from '../civ-rpc/meta';
import { RPC_MARSHAL } from '../civ-rpc/meta';
import { URL, fileURLToPath } from 'url';
import { ReadableStream } from 'stream/web';
import { isTypedArray } from 'lodash';

const PEEK_BUFFER_SIZE = 32 * 1024;

const sha256Hasher = new HashManager('sha256', 'hex');

export interface PartialFile {
    filePath?: string;
    fileStream?: string;
    fileBuffer?: Buffer | ArrayBuffer;
    sha256Sum?: string;
    mimeType?: string;
    mimeVec?: MIMEVec;
    size?: number;
    fileName?: string;
}

export class ResolvedFile {
    __resolvedOf!: FancyFile;
    mimeType!: string;
    mimeVec!: MIMEVec;
    fileName!: string;
    size!: number;
    sha256Sum?: string;
    filePath!: string;

    protected get [RPC_TRANSFER_PROTOCOL_META_SYMBOL](): TransferProtocolMetadata {
        return {
            contentType: this.mimeVec ? restoreContentType(this.mimeVec) : 'application/octet-stream',
            headers: {
                'content-length': `${this.size}`,
                'content-disposition': `attachment; filename="${this.fileName}"; filename*=UTF-8''${encodeURIComponent(this.fileName)}`,

                // RFC1864 being obsoleted, for not supporting partial responses.
                // https://datatracker.ietf.org/doc/html/rfc1864
                'content-sha256': this.sha256Sum || ''
            },
            envelope: null
        };
    }

    [RPC_MARSHAL]() {
        return transferProtocolMetaDecorated(
            this[RPC_TRANSFER_PROTOCOL_META_SYMBOL],
            this.createReadStream()
        );
    }

    createReadStream() {
        const fpath = this.filePath;

        return fs.createReadStream(fpath);
    }

    async unlink() {
        const fpath = this.filePath;

        return fsp.unlink(fpath);
    }
}

export interface HashedFile extends ResolvedFile {
    sha256Sum: string;
}

// const fileUnlinkedPromise = new Promise((resolve, reject) => {
//     reject(new Error('File already UNLINKED explicitly.'));
// });
// fileUnlinkedPromise.catch(() => undefined);

@Also({
    openapi: {
        schema: {
            type: 'string',
            format: 'binary'
        }
    }
})
@TPM({
    contentType: 'application/octet-stream',
    envelope: null
})
export class FancyFile {
    protected static _keys = ['mimeType', 'mimeVec', 'fileName', 'filePath', 'sha256Sum', 'size'];
    protected static _fromLocalFile(filePath: string, partialFile: PartialFile = {}) {
        if (!(filePath && typeof filePath === 'string')) {
            throw new Error('Auto fancy file requires a file path string.');
        }
        const fileInstance = new this();
        fileInstance._notSupposedToUnlink = true;
        fs.stat(filePath, (err, fstat) => {
            if (err) {
                return fileInstance._rejectAll(err);
            }
            fileInstance.fstat = fstat;
            fileInstance.size = partialFile.size || fstat.size;
            fileInstance.fileName = partialFile.fileName || basename(filePath);
            fileInstance.filePath = filePath;
        });
        if (partialFile.sha256Sum) {
            fileInstance.sha256Sum = partialFile.sha256Sum;
        }
        if (partialFile.mimeVec) {
            fileInstance.mimeVec = partialFile.mimeVec;
        } else if (partialFile.mimeType) {
            fileInstance.mimeVec = parseContentType(partialFile.mimeType);
        }

        return fileInstance;
    }

    protected static _fromStream(readable: Readable, tmpFilePath: string, partialFile: PartialFile = {}) {
        if (!(readable && typeof readable.pipe === 'function' && typeof readable.on === 'function')) {
            throw new Error('Auto fancy file from stream requires a file stream.');
        }
        const tmpTargetStream = fs.createWriteStream(tmpFilePath);
        const fileInstance = new this();
        const peekBuffers: Buffer[] = [];
        let sizeAcc = 0;
        readable.pause();
        fileInstance.fileName = partialFile.fileName || basename(tmpFilePath);
        if (partialFile.mimeVec) {
            fileInstance.mimeVec = partialFile.mimeVec;
        } else if (partialFile.mimeType) {
            fileInstance.mimeVec = parseContentType(partialFile.mimeType);
        } else {
            readable.once('__peek', () => {
                mimeOf(Buffer.concat(peekBuffers))
                    .then((mimeVec) => {
                        fileInstance.mimeVec = mimeVec;
                    })
                    .catch((err) => {
                        fileInstance._rejectAll(err, ['mimeType', 'mimeVec']);
                    });
            });
            const peekDataListener = (data: Buffer) => {
                peekBuffers.push(data);
                if (sizeAcc >= PEEK_BUFFER_SIZE) {
                    readable.removeListener('data', peekDataListener);
                    readable.emit('__peek');
                }
            };
            readable.on('data', peekDataListener);
        }
        readable.on('data', (data: Buffer) => {
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
        fileInstance.sha256Sum = partialFile.sha256Sum || (sha256Hasher.hashStream(readable) as Promise<string>);
        readable.on('error', (err: any) => fileInstance._rejectAll(err));
        tmpTargetStream.on('error', (err: any) => fileInstance._rejectAll(err));
        readable.pipe(tmpTargetStream);
        tmpTargetStream.once('finish', () => {
            fileInstance.filePath = tmpFilePath;
        });
        readable.resume();

        return fileInstance;
    }

    protected static _fromBuffer(buff: Buffer, tmpFilePath: string, partialFile: PartialFile = {}) {
        if (!buff || !(buff instanceof Buffer)) {
            throw new Error('Memory fancy file requires a buffer.');
        }
        const fileInstance = new this();
        if (partialFile.mimeVec) {
            fileInstance.mimeVec = partialFile.mimeVec;
        } else if (partialFile.mimeType) {
            fileInstance.mimeVec = parseContentType(partialFile.mimeType);
        } else {
            mimeOf(buff.slice(0, PEEK_BUFFER_SIZE))
                .then((mimeVec) => {
                    fileInstance.mimeVec = mimeVec;
                })
                .catch((err) => {
                    fileInstance._rejectAll(err, ['mimeType', 'mimeVec']);
                });
        }
        fileInstance.size = partialFile.size || buff.byteLength;
        fileInstance.fileName = partialFile.fileName || basename(tmpFilePath);
        fileInstance.sha256Sum = partialFile.sha256Sum || (sha256Hasher.hash(buff) as string);
        fileInstance.filePath = new Promise((resolve, reject) => {
            fs.open(tmpFilePath, 'w', (err, fd) => {
                if (err) {
                    return reject(err);
                }
                fs.write(fd, buff, (err2, _written) => {
                    if (err2) {
                        return reject(err2);
                    }
                    fs.close(fd, (err3) => {
                        if (err3) {
                            return reject(err3);
                        }
                        resolve(tmpFilePath);
                    });
                });
            });
        });

        return fileInstance;
    }

    static auto(fileURL: URL, partialFile?: PartialFile): FancyFile;
    static auto(partialFile: PartialFile, tmpFilePath?: string): FancyFile;
    static auto(readable: object, tmpFilePath: string, partialFile?: PartialFile): FancyFile;
    @AutoConstructor
    static auto(a: any, b?: any, c?: any) {
        if (!a) {
            throw new Error('Unrecognized Input. No Idea What To Do.');
        }
        if (typeof a !== 'object') {
            throw new Error('Auto fancy file excepts an object, use URL/TypedArray/Buffer/Stream, etc.');
        }

        if (a instanceof URL && a.protocol === 'file:') {
            return this._fromLocalFile(fileURLToPath(a.pathname), b);
        } else if (a instanceof URL && a.protocol === 'data:') {
            const data = a.toString().slice(a.protocol.length);
            const [mediaType, rest] = data.split(';');
            const [base64, dataStr] = rest.split(',');
            if (base64 !== 'base64') {
                throw new Error('Data URL must be base64 encoded.');
            }
            const buff = Buffer.from(dataStr, 'base64');

            return this._fromBuffer(buff, b, { size: buff.byteLength, mimeType: mediaType });
        } else if (a instanceof Buffer) {
            return this._fromBuffer(a, b, c);
        } else if (a instanceof ReadableStream) {
            return this._fromStream(Readable.fromWeb(a), b, c);
        } else if (a instanceof Blob) {
            return this._fromStream(Readable.fromWeb(a.stream()), b, { mimeType: a.type, size: a.size, ...c });
        } else if (isTypedArray(a)) {
            return this._fromBuffer(Buffer.from(a.buffer), b);
        } else if (a instanceof ArrayBuffer || a instanceof SharedArrayBuffer) {
            return this._fromBuffer(Buffer.from(a), b);
        } else if (typeof a.pipe === 'function') {
            return this._fromStream(a, b, c);
        } else if (a.fileStream) {
            return this._fromStream(a.fileStream, b, a);
        } else if (a.filePath) {
            return this._fromLocalFile(a.filePath, a);
        } else if (a.fileBuffer) {
            return this._fromBuffer(a.fileBuffer, b, a);
        }

        throw new Error('Unrecognized Input. No Idea What To Do.');
    }

    fstat?: fs.Stats;

    protected _notSupposedToUnlink = false;
    protected _deferreds: Map<string, Deferred<any>> = new Map();
    protected _all?: Promise<ResolvedFile>;

    protected _ensureDeferred(key: string) {
        if (!this._deferreds.get(key)) {
            const val = Defer<any>();
            this._deferreds.set(key, val);

            const subval = Object.create(val);
            subval.isNew = true;

            return subval;
        }

        return this._deferreds.get(key)!;
    }
    protected _resolveDeferred(key: string, value: any) {
        const deferred = this._ensureDeferred(key);
        deferred.resolve(value);

        return deferred.promise;
    }
    protected _rejectDeferred(key: string, err: Error) {
        const deferred = this._ensureDeferred(key);

        deferred.promise.catch(() => 0);
        deferred.reject(err);

        return deferred.promise;
    }
    protected _rejectAll(err: Error, keys = FancyFile._keys) {
        for (const x of keys) {
            this._rejectDeferred(x, err);
        }
    }

    get mimeType() {
        const deferred = this._ensureDeferred('mimeType');
        if (deferred.isNew) {
            (this.filePath as any)
                .then(mimeOf)
                .then((mimeVec: any) => {
                    this.mimeVec = mimeVec;
                })
                .catch((err: any) => {
                    this._rejectAll(err, ['mimeVec', 'mimeType']);
                });
        }

        return deferred.promise;
    }

    get mimeVec(): Promise<MIMEVec | null> {
        const deferred = this._ensureDeferred('mimeVec');
        if (deferred.isNew) {
            (this.filePath as any)
                .then(mimeOf)
                .then((mimeVec: any) => {
                    this.mimeVec = mimeVec;
                })
                .catch((err: any) => {
                    this._rejectAll(err, ['mimeVec', 'mimeType']);
                });
        }

        return deferred.promise;
    }

    set mimeVec(_mimeVec: string | MIMEVec | null | Promise<MIMEVec | null>) {
        let mimeVec = _mimeVec;
        if (typeof _mimeVec === 'string') {
            mimeVec = parseContentType(_mimeVec);
        }
        const r = this._resolveDeferred('mimeVec', mimeVec);
        r.then((mimeVec: MIMEVec) => {
            if (mimeVec) {
                this._resolveDeferred(
                    'mimeType',
                    `${mimeVec.mediaType || 'application'}/${mimeVec.subType || 'octet-stream'}${mimeVec.suffix ? '+' + mimeVec.suffix : ''
                    }`
                );
            } else {
                this._resolveDeferred('mimeType', 'application/octet-stream');
            }
        });
    }

    get fileName() {
        return this._ensureDeferred('fileName').promise;
    }

    set fileName(fileNameText: string | Promise<string>) {
        this._resolveDeferred('fileName', fileNameText);
    }

    get size() {
        return this._ensureDeferred('size').promise;
    }

    set size(sizeNumber: number | Promise<number>) {
        this._resolveDeferred('size', sizeNumber);
    }

    get sha256Sum() {
        const deferred = this._ensureDeferred('sha256Sum');
        if (deferred.isNew) {
            (this.filePath as any)
                .then(fs.createReadStream)
                .then((x: Readable) => sha256Hasher.hashStream(x))
                .then((x: string) => (this.sha256Sum = x))
                .catch((err: any) => {
                    this._rejectDeferred('sha256Sum', err);
                });
        }

        return deferred.promise;
    }

    set sha256Sum(sha256SumText: string | Promise<string>) {
        this._resolveDeferred('sha256Sum', sha256SumText);
    }

    get filePath() {
        return this._ensureDeferred('filePath').promise;
    }

    set filePath(filePathText: string | Promise<string>) {
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
                this.mimeType,
                this.mimeVec,
                this.fileName,
                this.size,
                this.sha256Sum,
                this.filePath,
            ]).then((vec: any) => {
                const [mimeType, mimeVec, fileName, size, sha256Sum, filePath] = vec;
                const resolvedFile = new ResolvedFile();
                Object.assign(resolvedFile, { mimeType, mimeVec, fileName, size, sha256Sum, filePath });
                resolvedFile.__resolvedOf = this;

                return resolvedFile;
            }) as Promise<ResolvedFile>;
        }

        return this._all;
    }

    async createReadStream(options?: any) {
        const fpath = await this.filePath;

        return fs.createReadStream(fpath, options);
    }

    async unlink(forced: any = false) {
        if (this._notSupposedToUnlink && !forced) {
            return Promise.resolve();
        }
        const fpath = await this.filePath;

        return fsp.unlink(fpath);
    }

    [RPC_MARSHAL]() {
        return this.resolve();
    }
}
