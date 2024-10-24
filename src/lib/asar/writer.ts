import path from 'path';

import { minimatch } from 'minimatch';

import { ASAR_ERROR, AsarArchive, buildArchiveHeader, createError, DirectoryMetadata, FileMetadata, naiveSplitPath } from './archive';
import { FsWalk, WalkEntity } from '../fswalk';
import { iterFileContents } from '../../utils/file-system';

import type tFSp from 'fs/promises';
import type tFS from 'fs';

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

const WR_BUFF_SIZE = 64 * 1024 * 1024;

export class AsarArchiveWriter extends AsarArchive {

    override header: DirectoryMetadata = { files: {} };

    chunks: Array<[number, number, string | Buffer]> = [];

    scanned: number = 0;

    override readyPromise!: Promise<tFSp.FileHandle>;

    constructor(fpath: string) {
        super(fpath);
    }

    override async init() {
        this.fd = await fsp.open(this.fpath, 'w');

        this.emit('open', this.fd);

        this.emit('ready', this.fd);
    }

    ensureDir(npath: string) {
        const pathVec = naiveSplitPath(npath);

        let ptr: unknown = this.header;
        for (const x of pathVec) {

            const thisnode = ptr as DirectoryMetadata;
            if (!thisnode?.files) {
                throw createError(ASAR_ERROR.NOT_DIR);
            }

            if (!thisnode.files.hasOwnProperty(x)) {
                Object.defineProperty(thisnode.files, x, { value: { files: {} }, enumerable: true, configurable: true, writable: true });
            }


            ptr = thisnode.files[x] as DirectoryMetadata;
        }

        return ptr as DirectoryMetadata;
    }

    async putFileByPath(npath: string, fpath: string, fstat?: tFS.Stats, relRoot?: string) {
        const pathVec = naiveSplitPath(npath);

        if (!pathVec.length) {
            throw createError(ASAR_ERROR.NOT_DIR);
        }

        const safeFSstat = fstat || await fsp.lstat(fpath);

        const fileName = pathVec.pop()!;

        const dirNode = this.ensureDir(pathVec.join('/'));

        if (safeFSstat?.isSymbolicLink()) {
            const linkContent = await fsp.readlink(fpath);

            const targetPath = path.resolve(path.dirname(fpath), linkContent);

            dirNode.files[fileName] = {
                link: path.relative(path.resolve(relRoot || path.dirname(this.fpath)), targetPath)
            };
        } else if (safeFSstat.isFile()) {

            dirNode.files[fileName] = {
                offset: `${this.bodyOffset}`,
                size: safeFSstat.size,
                executable: Boolean(process.platform !== 'win32' && (safeFSstat.mode & 0o100)) ? true : undefined
            };

            this.chunks.push([this.bodyOffset, safeFSstat.size, fpath]);

            this.bodyOffset += safeFSstat.size;
        } else {
            throw createError(ASAR_ERROR.IS_DIR);
        }

        return dirNode.files[fileName];
    }

    async putFileByBuffer(npath: string, buff: Buffer, isExecuteable = false) {
        const pathVec = naiveSplitPath(npath);

        if (!pathVec.length) {
            throw createError(ASAR_ERROR.NOT_DIR);
        }

        const fileName = pathVec.pop()!;
        const dirNode = this.ensureDir(pathVec.join('/'));

        const fnode = {
            offset: `${this.bodyOffset}`,
            size: buff.byteLength,
            executable: isExecuteable ? true : undefined
        } as FileMetadata;

        dirNode.files[fileName] = fnode;

        this.chunks.push([this.bodyOffset, buff.byteLength, buff]);

        this.bodyOffset += buff.byteLength;

        return fnode;
    }

    async putDirRecursively(fpath: string, globs: string[] = [], unpackedGlobs: string[] = []) {
        const globObjs = globs.map((x) => new minimatch.Minimatch(x));
        const unpackedGlobObjs = unpackedGlobs.map((x) => new minimatch.Minimatch(x));

        const walker = new FsWalk(fpath, { followSymlink: false, depthFirst: true });

        const fileHandler = async (file: WalkEntity) => {
            this.scanned += 1;
            let matched = false;
            for (const glob of globObjs) {
                const r = glob.match(file.relativePath as string);

                if (r && !glob.negate) {
                    matched = true;
                }

                if (!r && glob.negate) {
                    return;
                }
            }

            if (!matched) {
                return;
            }

            let unpack: boolean | undefined;
            for (const unpackGlob of unpackedGlobObjs) {
                const r = unpackGlob.match(file.relativePath as string);
                if (r && !unpackGlob.negate) {
                    unpack = true;
                }
                if (!r && unpackGlob.negate) {
                    unpack = false;
                    break;
                }
            }

            try {
                const node = await this.putFileByPath(file.relativePath as string, file.path as string, file.stats, fpath);
                if (unpack) {
                    node.unpacked = true;
                }

                return node;
            } catch (err) {
                throw err;
            }
        };

        const dirHandler = (dir: WalkEntity) => {
            this.scanned += 1;
            for (const glob of globObjs) {
                const r = glob.match(dir.relativePath as string);

                if (!r) {
                    return;
                }
            }

            const unpack = unpackedGlobObjs.reduce((prev, current) => {
                if (prev) {
                    return true;
                }

                return current.match(dir.relativePath as string);
            }, false);

            const node = this.ensureDir(dir.relativePath as string);
            if (unpack) {
                node.unpacked = true;
            }

            return node;
        };

        for await (const entry of walker.iterWalk()) {
            if (entry.type === 'file' || entry.type === 'symlink') {
                await fileHandler(entry.result);
                continue;
            }
            if (entry.type === 'dir') {
                dirHandler(entry.result);
                continue;
            }
        }

        return this.header;
    }

    async writeToFile() {
        const fd = await this.readyPromise;
        const headerBuff = buildArchiveHeader(this.header);
        await fd.write(headerBuff, 0, headerBuff.byteLength, 0);

        this.chunks.sort(([offset1], [offset2]) => {
            return offset1 - offset2;
        });

        for (const [offset, size, source] of this.chunks) {
            if (Buffer.isBuffer(source)) {
                await fd.write(source, 0, size, headerBuff.byteLength + offset);
                continue;
            }

            let thisBytesWritten = 0;
            for await (const chunk of iterFileContents(source, WR_BUFF_SIZE)) {
                const r = await fd.write(chunk, 0, chunk.byteLength, headerBuff.byteLength + offset + thisBytesWritten);
                thisBytesWritten += r.bytesWritten;
                if (thisBytesWritten > size) {
                    throw new Error(`File data offset out of bound: ${source} at ${thisBytesWritten}`);
                }
            }
        }

        return this;
    }
}
