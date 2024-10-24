import { EventEmitter } from "events";
import path from 'path';

import type tFSp from 'fs/promises';

let fs: typeof import('fs');

try {
    fs = require('original-fs');
} catch (err: any) {
    if (err.code === 'MODULE_NOT_FOUND') {
        fs = require('fs');
    } else {
        throw err;
    }
}
const fsp = fs.promises;

// ASAR Integrity extension is just 鸡肋.
export interface ASARFileIntegrityExtension {
    algorithm: 'SHA256' | string;
    hash: string;
    blockSize: number;
    blocks: string[];
}

export interface EntryMetadata {
    unpacked?: boolean;
}

export interface FileMetadata extends EntryMetadata {
    executable?: true;
    offset: string;
    size: number;

    integrity?: ASARFileIntegrityExtension;
}

export interface LinkMetadata extends EntryMetadata {
    link: string;
}

export interface DirectoryMetadata extends EntryMetadata {
    files: { [property: string]: DirectoryMetadata | FileMetadata | LinkMetadata; };
}

export type ASARNodeMetadata = FileMetadata | LinkMetadata | DirectoryMetadata;

const BUFF_SIZE = 4 * 1024 * 1024;

const kSeparators = process.platform === 'win32' ? /[\\/]/ : /\//;

export function naiveSplitPath(npath: string) {
    return npath.split(kSeparators).filter((x) => Boolean(x));
}

export function splitPath(npath: string) {
    const pathVec = npath.split(kSeparators);
    let isAsar = false;
    let asarPath, filePath;
    for (const [i, v] of pathVec.entries()) {
        if (v.endsWith('.asar')) {
            isAsar = true;
            asarPath = pathVec.slice(0, i + 1).join(path.sep);
            filePath = pathVec.slice(i + 1).join(path.sep);
            break;
        }
    }
    if (!isAsar) {
        return { isAsar: false };
    }

    return {
        isAsar,
        asarPath,
        filePath
    };
}

export const enum ASAR_ERROR {
    NOT_FOUND = 'NOT_FOUND',
    NOT_DIR = 'NOT_DIR',
    NO_ACCESS = 'NO_ACCESS',
    IS_DIR = 'IS_DIR',
    READ_ONLY = 'READ_ONLY',
    INVALID_ARCHIVE = 'INVALID_ARCHIVE'
}

export type AsarErrorObject = Error & { code?: string, errno?: number; };

export function createError(errorType: ASAR_ERROR, { asarPath, filePath }: { asarPath?: string, filePath?: string; } = {}) {
    let error: AsarErrorObject;
    switch (errorType) {
        case ASAR_ERROR.NOT_FOUND:
            error = new Error(`ENOENT, ${filePath} not found in ${asarPath}`);
            error.code = 'ENOENT';
            error.errno = -2;
            break;
        case ASAR_ERROR.NOT_DIR:
            error = new Error('ENOTDIR, not a directory');
            error.code = 'ENOTDIR';
            error.errno = -20;
            break;
        case ASAR_ERROR.IS_DIR:
            error = new Error('EISDIR, illegal operation on a directory');
            error.code = 'EISDIR';
            error.errno = -21;
            break;
        case ASAR_ERROR.NO_ACCESS:
            error = new Error(`EACCES: permission denied, access '${filePath}'`);
            error.code = 'EACCES';
            error.errno = -13;
            break;
        case ASAR_ERROR.INVALID_ARCHIVE:
            error = asarPath ? new Error(`Invalid package ${asarPath}`) : new Error(`Invalid ASAR package`);
            error.code = 'CORRUPT_ARCHIVE';
            break;
        case ASAR_ERROR.READ_ONLY:
            error = new Error(`EROFS: read-only file system, open '${path.join(asarPath!, filePath!)}'`);
            error.code = 'EROFS';
            error.errno = -30;
            break;
        default:
            throw new Error(`Invalid error type "${errorType}" passed to createError.`);
    }
    return error;
}


//
//                  ASAR Structure
//
//  | HEADER_SIZE_PICKLE  | HEADER_PICKLE[HEADER_SIZE] | BODY |
//  |   8 Bytes           |     HEADER_SIZE Bytes      |      |
//  |  UINT32LE UINT32LE  |                            |      |
//  |                  BODY OFFSET                     |      |
//
//

export const ASAR_HEADER_SIZE_BYTE_LENGTH = 8;
export const PICKLE_ALIGNMENT_SIZE = 4;

export function readArchiveHeaderSync(fd: number, consume = false) {
    try {
        const sizeBuf = Buffer.alloc(ASAR_HEADER_SIZE_BYTE_LENGTH);

        const r1 = fs.readSync(fd, sizeBuf, 0, sizeBuf.byteLength, 0);
        if (r1 !== sizeBuf.byteLength) {
            throw createError(ASAR_ERROR.INVALID_ARCHIVE);
        }

        const size = sizeBuf.readInt32LE(0 + PICKLE_ALIGNMENT_SIZE);
        const headerPickleBuf = Buffer.alloc(size - PICKLE_ALIGNMENT_SIZE);

        const r2 = fs.readSync(fd, headerPickleBuf, 0, headerPickleBuf.byteLength, ASAR_HEADER_SIZE_BYTE_LENGTH + PICKLE_ALIGNMENT_SIZE);
        if (r2 !== headerPickleBuf.byteLength) {
            throw createError(ASAR_ERROR.INVALID_ARCHIVE);
        }

        const acturalStringSize = headerPickleBuf.readUInt32LE(0);
        const stringBuff = headerPickleBuf.subarray(PICKLE_ALIGNMENT_SIZE, acturalStringSize + PICKLE_ALIGNMENT_SIZE);

        return { header: JSON.parse(stringBuff.toString('utf-8')), bodyOffset: size + ASAR_HEADER_SIZE_BYTE_LENGTH };
    } catch (err: any) {
        if (err.code) {
            throw err;
        }

        throw createError(ASAR_ERROR.INVALID_ARCHIVE);
    } finally {
        if (consume) {
            fs.closeSync(fd);
        }
    }
}

export async function readArchiveHeader(fd: tFSp.FileHandle, consume = false) {
    try {
        const sizeBuf = Buffer.alloc(ASAR_HEADER_SIZE_BYTE_LENGTH);

        const r1 = await fd.read(sizeBuf, 0, sizeBuf.byteLength, 0);
        if (r1.bytesRead !== sizeBuf.byteLength) {
            throw createError(ASAR_ERROR.INVALID_ARCHIVE);
        }

        const size = sizeBuf.readInt32LE(0 + PICKLE_ALIGNMENT_SIZE);
        const headerPickleBuf = Buffer.alloc(size - PICKLE_ALIGNMENT_SIZE);

        const r2 = await fd.read(headerPickleBuf, 0, headerPickleBuf.byteLength, ASAR_HEADER_SIZE_BYTE_LENGTH + PICKLE_ALIGNMENT_SIZE);
        if (r2.bytesRead !== headerPickleBuf.byteLength) {
            throw createError(ASAR_ERROR.INVALID_ARCHIVE);
        }

        const acturalStringSize = headerPickleBuf.readUInt32LE(0);
        const stringBuff = headerPickleBuf.subarray(PICKLE_ALIGNMENT_SIZE, acturalStringSize + PICKLE_ALIGNMENT_SIZE);

        return { header: JSON.parse(stringBuff.toString('utf-8')), bodyOffset: size + ASAR_HEADER_SIZE_BYTE_LENGTH };
    } catch (err: any) {
        if (err.code) {
            throw err;
        }

        throw createError(ASAR_ERROR.INVALID_ARCHIVE);
    } finally {
        if (consume) {
            fd.close().catch(() => 0);
        }
    }
}

export function buildArchiveHeader(jsObject: DirectoryMetadata) {
    const text = JSON.stringify(jsObject);
    const bytes = Buffer.from(text, 'utf-8');

    const bytesToPad = PICKLE_ALIGNMENT_SIZE - ((bytes.byteLength + 4) % PICKLE_ALIGNMENT_SIZE);

    const paddBuff = Buffer.alloc(bytesToPad, 0);

    const pickleHeader = Buffer.allocUnsafe(PICKLE_ALIGNMENT_SIZE + 4);
    pickleHeader.writeUInt32LE(4 + bytes.byteLength + bytesToPad, 0);
    pickleHeader.writeUInt32LE(bytes.byteLength, PICKLE_ALIGNMENT_SIZE);

    const actualSize = pickleHeader.byteLength + bytes.byteLength + bytesToPad;

    const archiveHeader = Buffer.allocUnsafe(ASAR_HEADER_SIZE_BYTE_LENGTH);
    archiveHeader.writeUInt32LE(PICKLE_ALIGNMENT_SIZE, 0);
    archiveHeader.writeUInt32LE(actualSize, PICKLE_ALIGNMENT_SIZE);

    return Buffer.concat([archiveHeader, pickleHeader, bytes, paddBuff], actualSize + ASAR_HEADER_SIZE_BYTE_LENGTH);
}

export const MAX_LEVEL_OF_SYMLINKS = 10;

export class SynchronousAsarArchive extends EventEmitter {

    header!: DirectoryMetadata;

    bodyOffset: number = 0;

    fd?: number;

    constructor(public fpath: string) {
        super();

        this.init();
    }

    init() {
        const fd = fs.openSync(this.fpath, 'rs');
        const result = readArchiveHeaderSync(fd, true);

        this.emit('open', result);

        this.header = result.header;
        this.bodyOffset = result.bodyOffset;

        this.emit('header', this.header, this.bodyOffset);

        this.emit('ready');
    }


    seekFNode(npath: string, depth = MAX_LEVEL_OF_SYMLINKS): ASARNodeMetadata | undefined {
        const origPathVec = naiveSplitPath(npath);

        const pathVec: string[] = [];

        for (const x of origPathVec) {
            if (!x) {
                continue;
            }
            if (x === '.') {
                continue;
            }

            if (x === '..') {
                pathVec.pop();
                continue;
            }

            pathVec.push(x);
        }

        if (!pathVec.length) {
            return;
        }

        if (!this.header) {
            return;
        }

        let ptr: Partial<DirectoryMetadata & LinkMetadata & FileMetadata> | undefined = this.header;

        for (const cur of pathVec) {
            if (!ptr) {
                return;
            }
            if (ptr?.link) {
                if (depth <= 0) {
                    return ptr as any;
                }
                ptr = this.seekFNode(`${ptr.link}${path.sep}${cur}`, depth - 1);
            } else if (ptr?.files) {
                ptr = ptr.files[cur];
            } else {
                return;
            }
        }

        if (ptr?.link) {
            ptr = this.seekFNode(ptr.link, depth - 1);
        }

        return ptr === this.header ? undefined : ptr as any;
    }

    readFile(npath: string | ASARNodeMetadata) {
        const node = typeof npath === 'string' ? this.seekFNode(npath) : npath;

        if (!node) {
            throw createError(ASAR_ERROR.NOT_FOUND, { asarPath: this.fpath, filePath: `${npath}` });
        }


        if ((node as DirectoryMetadata).files) {
            throw createError(ASAR_ERROR.IS_DIR, { asarPath: this.fpath, filePath: `${npath}` });
        }

        if ((node as FileMetadata).size === undefined) {
            throw createError(ASAR_ERROR.NOT_FOUND, { asarPath: this.fpath, filePath: `${npath}` });
        }

        const fnode = node as FileMetadata;
        // const fsize = parseInt(fnode.size, 10);
        const fsize = fnode.size;

        const contentBuff = Buffer.allocUnsafe(fsize);

        const numericOffset = BigInt(fnode.offset);

        const fd = fs.openSync(this.fpath, 'rs');
        fs.readSync(fd, contentBuff, 0, fsize, numericOffset + BigInt(this.bodyOffset!));

        return contentBuff;
    }

    createReadStream(npath: string | ASARNodeMetadata, options?: Parameters<typeof fs.createReadStream>[1]) {
        const node = typeof npath === 'string' ? this.seekFNode(npath) : npath;

        if (!node) {
            throw createError(ASAR_ERROR.NOT_FOUND, { asarPath: this.fpath, filePath: `${npath}` });
        }

        if ((node as LinkMetadata).link) {
            throw createError(ASAR_ERROR.NO_ACCESS, { asarPath: this.fpath, filePath: `${npath}` });
        }

        if ((node as DirectoryMetadata).files) {
            throw createError(ASAR_ERROR.IS_DIR, { asarPath: this.fpath, filePath: `${npath}` });
        }

        const fnode = node as FileMetadata;
        // const fsize = parseInt(fnode.size, 10);
        const fsize = fnode.size;

        const numericOffset = BigInt(fnode.offset);

        const createReadStreamOptions: any = {};

        if (typeof options === 'string') {
            createReadStreamOptions.mode = options;
        } else if (typeof options === 'object' && options) {
            Object.assign(createReadStreamOptions, options);
        }

        const equivalentStart = numericOffset + BigInt(this.bodyOffset + (createReadStreamOptions?.start || 0));
        const equivalentEnd = numericOffset + BigInt(this.bodyOffset + fsize - 1 + (createReadStreamOptions?.end || 0));

        createReadStreamOptions.start = equivalentStart;
        createReadStreamOptions.end = equivalentEnd;

        if (createReadStreamOptions.flags && createReadStreamOptions.flags !== 'r' && createReadStreamOptions.flags !== 'rs') {
            createReadStreamOptions.flags = 'r';
            const stream = fs.createReadStream(this.fpath, createReadStreamOptions);
            process.nextTick(() => {
                stream.destroy(createError(ASAR_ERROR.READ_ONLY, { asarPath: this.fpath, filePath: `${npath}` }));
            });

            return stream;
        }

        return fs.createReadStream(this.fpath, createReadStreamOptions);
    }

    *iterNodes(ptr = this.header, pathStack: string[] = []): Generator<{
        node: ASARNodeMetadata; path: string;
        isDir: boolean;
        isLink: boolean;
        isFile: boolean;
    }> {
        if (ptr.files) {
            yield { node: ptr, path: path.join(...pathStack), isDir: true, isLink: false, isFile: false };

            for (const [name, node] of Object.entries(ptr.files)) {
                if ((node as DirectoryMetadata).files) {
                    yield* this.iterNodes(node as DirectoryMetadata, [...pathStack, name]);
                    continue;
                }

                if ((node as LinkMetadata).link) {
                    yield { node, path: path.join(...pathStack, name), isDir: false, isLink: true, isFile: false };
                    continue;
                }

                if ((node as FileMetadata).size) {
                    yield { node, path: path.join(...pathStack, name), isDir: false, isLink: false, isFile: true };
                    continue;
                }

            }
        }
    }

    protected ensureSourceFd() {
        if (this.fd) {
            return this.fd;
        }
        this.fd = fs.openSync(this.fpath, 'rs');

        return this.fd;
    }

    protected closeSourceFd() {
        if (this.fd) {
            fs.closeSync(this.fd);
            delete this.fd;
        }
    }

    protected buffedWrite(targetPath: string, fileNode: FileMetadata) {
        const sourceFd = this.ensureSourceFd();
        const targetFd = fs.openSync(targetPath, 'w', fileNode.executable ? 0o777 : 0o666);
        const numericOffset = BigInt(fileNode.offset);
        const buff = Buffer.allocUnsafe(BUFF_SIZE);
        let bytesToCopy = fileNode.size;
        let bytesCopied = 0;

        while (bytesToCopy > 0) {
            const deltaBytes = bytesToCopy > buff.byteLength ? buff.byteLength : bytesToCopy;
            bytesToCopy -= fs.readSync(sourceFd, buff, 0, deltaBytes, BigInt(this.bodyOffset) + numericOffset + BigInt(bytesCopied));
            bytesCopied += fs.writeSync(targetFd, buff, 0, deltaBytes, bytesCopied);
        }
        fs.closeSync(targetFd);
    }

    async unpack(targetRoot: string = `${this.fpath}.unpacked`, all: boolean = false) {
        for (const { node, path, isDir, isFile, isLink } of this.iterNodes(this.header, [targetRoot])) {
            if (!all && !node.unpacked) {
                continue;
            }

            if (isDir) {
                fs.mkdirSync(path, { recursive: true });
                continue;
            }
            if (isLink) {
                if (process.platform === 'win32') {
                    // Windows sucks. Making Symlink defaults to requires admin privilidge.
                    // So deref links here.
                    const targetNode = this.seekFNode((node as LinkMetadata).link, 0);
                    if (targetNode) {
                        this.buffedWrite(path, node as FileMetadata);
                    }

                    continue;
                }

                fs.symlinkSync((node as LinkMetadata).link, path);
                continue;
            }
            if (isFile) {
                this.buffedWrite(path, node as FileMetadata);
                continue;
            }
        }

        this.closeSourceFd();

        return;
    }

    close() {
        if (!this.fd) {
            return;
        }

        fs.closeSync(this.fd!);
        delete this.fd;
    }

}

export class AsarArchive extends EventEmitter {

    header!: DirectoryMetadata;

    bodyOffset: number = 0;

    fd?: tFSp.FileHandle;

    readyPromise: Promise<unknown>;

    openMode: string = 'r';

    constructor(public fpath: string) {
        super();

        this.init().catch((err) => this.emit('error', err));
        this.readyPromise = new Promise((resolve, reject) => {
            this.once('ready', resolve);
            this.once('error', reject);
        });
    }

    async init() {
        const fd = await fsp.open(this.fpath, this.openMode);

        const result = await readArchiveHeader(fd, true);

        this.emit('open', result);

        this.header = result.header;
        this.bodyOffset = result.bodyOffset;

        this.emit('header', this.header, this.bodyOffset);

        this.emit('ready');
    }

    seekFNode(npath: string, depth = MAX_LEVEL_OF_SYMLINKS): ASARNodeMetadata | undefined {
        const origPathVec = naiveSplitPath(npath);

        const pathVec: string[] = [];

        for (const x of origPathVec) {
            if (!x) {
                continue;
            }
            if (x === '.') {
                continue;
            }

            if (x === '..') {
                pathVec.pop();
                continue;
            }

            pathVec.push(x);
        }

        if (!pathVec.length) {
            return;
        }

        if (!this.header) {
            return;
        }

        let ptr: Partial<DirectoryMetadata & LinkMetadata & FileMetadata> | undefined = this.header;

        for (const cur of pathVec) {
            if (!ptr) {
                return;
            }
            if (ptr?.link) {
                if (depth <= 0) {
                    return ptr as any;
                }
                ptr = this.seekFNode(`${ptr.link}${path.sep}${cur}`, depth - 1);
            } else if (ptr?.files) {
                ptr = ptr.files[cur];
            } else {
                return;
            }
        }

        if (ptr?.link) {
            ptr = this.seekFNode(ptr.link, depth - 1);
        }

        return ptr === this.header ? undefined : ptr as any;
    }

    async readFile(npath: string | ASARNodeMetadata) {
        const node = typeof npath === 'string' ? this.seekFNode(npath) : npath;

        if (!node) {
            throw createError(ASAR_ERROR.NOT_FOUND, { asarPath: this.fpath, filePath: `${npath}` });
        }


        if ((node as DirectoryMetadata).files) {
            throw createError(ASAR_ERROR.IS_DIR, { asarPath: this.fpath, filePath: `${npath}` });
        }

        if ((node as FileMetadata).size === undefined) {
            throw createError(ASAR_ERROR.NOT_FOUND, { asarPath: this.fpath, filePath: `${npath}` });
        }

        const fnode = node as FileMetadata;
        // const fsize = parseInt(fnode.size, 10);
        const fsize = fnode.size;

        const contentBuff = Buffer.allocUnsafe(fsize);

        const numericOffset = BigInt(fnode.offset);

        const fd = await fsp.open(this.fpath, 'r');
        fd.read(contentBuff, 0, fsize, numericOffset + BigInt(this.bodyOffset!) as any);

        return contentBuff;
    }

    createReadStream(npath: string | ASARNodeMetadata, options?: Parameters<typeof fs.createReadStream>[1]) {
        const node = typeof npath === 'string' ? this.seekFNode(npath) : npath;

        if (!node) {
            throw createError(ASAR_ERROR.NOT_FOUND, { asarPath: this.fpath, filePath: `${npath}` });
        }

        if ((node as LinkMetadata).link) {
            throw createError(ASAR_ERROR.NO_ACCESS, { asarPath: this.fpath, filePath: `${npath}` });
        }

        if ((node as DirectoryMetadata).files) {
            throw createError(ASAR_ERROR.IS_DIR, { asarPath: this.fpath, filePath: `${npath}` });
        }

        const fnode = node as FileMetadata;
        // const fsize = parseInt(fnode.size, 10);
        const fsize = fnode.size;

        const numericOffset = BigInt(fnode.offset);

        const createReadStreamOptions: any = {};

        if (typeof options === 'string') {
            createReadStreamOptions.mode = options;
        } else if (typeof options === 'object' && options) {
            Object.assign(createReadStreamOptions, options);
        }

        const equivalentStart = numericOffset + BigInt(this.bodyOffset + (createReadStreamOptions?.start || 0));
        const equivalentEnd = numericOffset + BigInt(this.bodyOffset + fsize - 1 + (createReadStreamOptions?.end || 0));

        createReadStreamOptions.start = equivalentStart;
        createReadStreamOptions.end = equivalentEnd;

        if (createReadStreamOptions.flags && createReadStreamOptions.flags !== 'r' && createReadStreamOptions.flags !== 'rs') {
            createReadStreamOptions.flags = 'r';
            const stream = fs.createReadStream(this.fpath, createReadStreamOptions);
            process.nextTick(() => {
                stream.destroy(createError(ASAR_ERROR.READ_ONLY, { asarPath: this.fpath, filePath: `${npath}` }));
            });

            return stream;
        }

        return fs.createReadStream(this.fpath, createReadStreamOptions);
    }

    protected async ensureSourceFd() {
        if (this.fd) {
            return this.fd;
        }
        this.fd = await fsp.open(this.fpath, 'r');

        return this.fd;
    }

    protected async closeSourceFd() {
        if (this.fd) {
            await this.fd.close();
            delete this.fd;
        }
    }

    close() {
        return this.fd?.close();
    }

}
