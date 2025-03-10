import fs, { promises as fsp } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { Readable } from 'stream';
import { FancyFile } from './fancy-file';
import { AsyncService } from './async-service';
import { PromiseThrottle } from './throttle';
import { randomUUID } from 'crypto';
import { pathToFileURL } from 'url';

export abstract class AbstractTempFileManger extends AsyncService {
    abstract rootDir: string;

    protected finalizationRegistry: FinalizationRegistry<string>;
    protected trackedPaths: Set<string> = new Set();

    constructor(..._args: any[]) {
        super(...arguments);

        this.finalizationRegistry = new FinalizationRegistry((x: string) => {
            this.remove(x).catch(() => 'swallow');
        });

        let exitTimer: ReturnType<typeof setTimeout>;
        const cleanupFunc = (code: any) => {
            for (const x of this.trackedPaths) {
                try {
                    fs.rmSync(x);
                } catch (_err) {
                    void 0;
                }
            }
            this.trackedPaths.clear();
            if (!exitTimer) {
                exitTimer = setTimeout(() => process.exit(code), 100);
            }
        };
        process.on('exit', cleanupFunc);
        // process.on('SIGKILL', cleanupFunc);
    }

    override async standDown() {
        super.standDown();
        const throttler = new PromiseThrottle(2 * 10);
        const promises = Array.from(this.trackedPaths.values()).map(async (x) => {
            await throttler.acquire();
            try {
                await fsp.rm(x, { recursive: true, force: true, maxRetries: 3 });
                this.trackedPaths.delete(x);
            } catch (_e) {
                void 0;
            } finally {
                throttler.release();
            }
        });

        await Promise.allSettled(promises);
    }

    override async init() {
        if (this.rootDir) {
            try {
                const fstat = await fsp.stat(this.rootDir);
                if (!fstat.isDirectory()) {
                    throw new Error('TmpFile target dir was not a dir: ' + this.rootDir);
                }
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    await fsp.mkdir(this.rootDir, { recursive: true });
                } else {
                    throw new Error('Error stating tmpfile target dir: ' + this.rootDir);
                }
            }

        } else {
            this.rootDir = await fsp.mkdtemp(path.join(tmpdir(), 'nodejs-application-'));
        }
    }

    fullPath(relativePath?: string) {
        const result = path.resolve(this.rootDir, relativePath || this.newName());

        if (path.relative(this.rootDir, result).startsWith('..')) {
            throw new Error(`Security Violation: ${this.constructor.name} must not operate outside its rootDir !`);
        }

        return path.resolve(this.rootDir, relativePath || this.newName());
    }

    newName() {
        return randomUUID();
    }

    async touch(relativePath?: string, options: { flags?: string | number, mode?: fs.Mode, close?: boolean; } = {}) {
        const absPath = this.alloc(relativePath);

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

    alloc(relativePath?: string) {

        const fullPath = this.fullPath(relativePath);
        this.trackedPaths.add(fullPath);
        return fullPath;
    }

    async newWriteStream(relativePath?: string, options: { flags?: string | number, mode?: fs.Mode; } = {}) {
        const r = await this.touch(relativePath, { ...options, close: true });

        return fs.createWriteStream(r.absPath);
    }

    getReadStream(relativePath: string, ...args: any[]) {
        return fs.createReadStream(this.fullPath(relativePath), ...args);
    }

    remove(relativePath: string) {
        const pathToRemove = this.fullPath(relativePath);
        this.trackedPaths.delete(pathToRemove);

        return fsp.rm(pathToRemove, { recursive: true, force: true, maxRetries: 5 });
    }

    async nuke() {
        const dirContents = await fsp.readdir(this.rootDir);
        await Promise.all(dirContents.map(async (x) => fsp.rm(x, { recursive: true, force: true, maxRetries: 5 })));
        this.trackedPaths.clear();
        super.standDown();
    }

    cacheReadable(readable: Readable, fileName?: string) {
        const tmpFilePath = this.alloc();

        const r = FancyFile.auto(readable, tmpFilePath, { fileName });
        this.finalizationRegistry.register(r, tmpFilePath);

        return r;
    }

    cacheBuffer(buff: Buffer, fileName?: string) {
        const tmpFilePath = this.alloc();

        const r = FancyFile.auto(buff, tmpFilePath, { fileName });
        this.finalizationRegistry.register(r, tmpFilePath);

        return r;
    }

    cacheText(str: string, fileName?: string) {
        return this.cacheBuffer(Buffer.from(str), fileName);
    }

    bindPathTo<T extends object>(thing: T, path: string) {
        const fullPath = this.fullPath(path);

        this.finalizationRegistry.register(thing, fullPath);

        return thing;
    }

    access(fileName: string) {
        return FancyFile.auto(pathToFileURL(this.fullPath(fileName)));
    }

    mkdir(dirName: string) {
        const fullPath = this.alloc(dirName);

        return fsp.mkdir(fullPath, { recursive: true });
    }

    async touchDir(dirName?: string) {
        const newName = dirName || this.newName();

        const absPath = this.alloc(newName);

        await this.mkdir(newName);

        return {
            absPath,
            relativePath: path.relative(this.rootDir, absPath),
            dirName: path.basename(absPath),
        };
    }
}
