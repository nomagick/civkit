import { v1 as UUIDv1 } from 'uuid';
import fs, { promises as fsp } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { FancyFile } from './fancy-file';
import { AsyncService } from './async-service';

export abstract class AbstractTempFileManger extends AsyncService {
    abstract rootDir: string;

    override async init() {
        if (this.rootDir) {
            try {
                const fstat = await fsp.stat(this.rootDir);
                if (!fstat.isDirectory()) {
                    throw new Error('TmpFile targert dir was not a dir: ' + this.rootDir);
                }
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    await fsp.mkdir(this.rootDir, { recursive: true });
                } else {
                    throw new Error('Error stating tmpfile target dir: ' + this.rootDir);
                }
            }

        } else {
            this.rootDir = await fsp.mkdtemp('nodejs-application-');
        }
    }

    fullPath(relativePath?: string) {
        return path.resolve(this.rootDir, relativePath || this.newName());
    }

    newName() {
        return UUIDv1();
    }

    async touch(relativePath?: string, options: { flags?: string | number, mode?: fs.Mode, close?: boolean } = {}) {
        const absPath = this.fullPath(relativePath);

        const fileHandle = await fsp.open(absPath, options.flags || 'wx+', options.mode);

        if (options.close) {
            await fileHandle.close();

            return {
                absPath: absPath,
                relativePath: path.relative(this.rootDir, absPath),
                fileName: path.basename(absPath)
            };
        }

        return {
            absPath: absPath,
            relativePath: path.relative(this.rootDir, absPath),
            fileName: path.basename(absPath),
            fileHandle
        };
    }

    alloc() {
        return this.fullPath();
    }

    async newWriteStream(relativePath?: string, options: { flags?: string | number, mode?: fs.Mode } = {}) {
        const r = await this.touch(relativePath, { ...options, close: true });

        return fs.createWriteStream(r.absPath);
    }

    getReadStream(relativePath: string, ...args: any[]) {
        return fs.createReadStream(this.fullPath(relativePath), ...args);
    }

    remove(relativePath: string) {
        return fsp.rm(this.fullPath(relativePath), { recursive: true, force: true, maxRetries: 5 });
    }

    cacheReadable(readable: Readable, fileName?: string) {
        const tmpFilePath = this.fullPath();

        return FancyFile.auto(readable, tmpFilePath, { fileName });
    }

    cacheBuffer(buff: Buffer, fileName?: string) {
        const tmpFilePath = this.fullPath();

        return FancyFile.auto(buff, tmpFilePath, { fileName });
    }

    cacheText(str: string, fileName?: string) {
        return this.cacheBuffer(Buffer.from(str), fileName);
    }

    access(fileName: string) {
        return FancyFile.auto(this.fullPath(fileName));
    }

    mkdir(dirName: string) {
        const fullPath = this.fullPath(dirName);

        return fsp.mkdir(fullPath, { recursive: true });
    }

    async touchDir(dirName?: string) {
        const newName = dirName || this.newName();

        const absPath = this.fullPath(newName);

        await this.mkdir(newName);

        return {
            absPath,
            relativePath: path.relative(this.rootDir, absPath),
            dirName: path.basename(absPath),
        };
    }

}
