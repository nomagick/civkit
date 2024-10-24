import { EventEmitter } from 'events';
import * as pathModule from 'path';
import { promises as fsp, Stats } from 'fs';
import { PromiseThrottle } from './throttle';
import _ from 'lodash';

export interface WalkOptions {
    throttle?: number;
    symlinkDepth?: number;
    followSymlink?: boolean;
    depthFirst?: boolean;
    rootPrefix?: string | Buffer;
}

export interface WalkEntity {
    path: string | Buffer;
    relativePath: string | Buffer;
    stats: Stats;
}
export interface WalkOutEntity extends WalkEntity {
    type: 'file' | 'dir';
}

export class FsWalk extends EventEmitter {

    static walk(fpath: string, options?: WalkOptions) {
        const ins = new this(fpath, options);
        ins.walk();

        return ins;
    }

    static walkOut(fpath: string, options?: WalkOptions): Promise<WalkOutEntity[]> {
        return new Promise((resolve, reject) => {
            const entries: any[] = [];
            const ins = new this(fpath, options);
            ins.on('end', () => {
                resolve(entries);
            });
            ins.on('error', (err: Error) => {
                reject(err);
            });
            ins.on('file', (file: any) => {
                entries.push(Object.assign({ type: 'file' }, file));
            });
            ins.on('dir', (dir: any) => {
                entries.push(Object.assign({ type: 'dir' }, dir));
            });
            ins.walk().catch((err) => {
                reject(err);
            });
        });
    }

    origPath: string;
    followSymink: boolean;
    symlinkDepth: number;
    _kInstances: number = 0;
    throttle: PromiseThrottle;
    depthFirst: boolean;
    rootPrefix: string;
    constructor(fpath: string, _options: WalkOptions = {}) {
        super();
        const options: any = _.defaults(_options, {
            throttle: 10,
            symlinkDepth: 30,
            followSymlink: false,
            depthFirst: true,
            rootPrefix: ''
        });
        this.rootPrefix = options.rootPrefix;
        this.origPath = fpath;
        this.followSymink = Boolean(options.followSymlink);
        this.throttle = new PromiseThrottle(parseInt(options.throttle));
        this.symlinkDepth = parseInt(options.symlinkDepth);
        this.depthFirst = Boolean(options.depthFirst);
    }

    async walk(thePath: string = this.origPath, relativePathStack: string[] = [this.rootPrefix], symlinkDepth = this.symlinkDepth) {
        this._kInstances += 1;
        let acquiredResource: any = await this.throttle.acquire();

        const absPath = thePath === this.origPath ? await fsp.realpath(thePath) : thePath;
        const curStat: Stats = await fsp.lstat(absPath);


        const result: any = {
            stats: curStat
        };

        result.path = absPath;
        const rPathVecs = _.compact(relativePathStack);
        result.relativePath = rPathVecs.length ? pathModule.join(...rPathVecs) : '';

        if (curStat.isFile()) {
            this.emit('file', result);

        } else if (curStat.isDirectory()) {
            this.emit('dir', result);
            const fList = await fsp.readdir(absPath);
            if (this.depthFirst && acquiredResource) {
                acquiredResource.release();
                acquiredResource = null;
            }
            for (const fName of fList) {
                const p = this.walk(pathModule.join(absPath, fName), [...relativePathStack, fName], symlinkDepth);
                if (this.depthFirst) {
                    await p;
                } else {
                    p.catch((err) => {
                        this.emit('error', err);
                    });
                }
            }
        } else if (curStat.isSymbolicLink()) {
            this.emit('symlink', result);
            if (this.followSymink && symlinkDepth > 0) {
                const linkContent = await fsp.readlink(absPath);
                let theOtherEnd;
                const linkContentString = linkContent;
                if (pathModule.isAbsolute(linkContentString)) {
                    theOtherEnd = linkContent;
                } else {
                    theOtherEnd = await fsp.realpath(pathModule.join(absPath, linkContent));
                }
                if (this.depthFirst && acquiredResource) {
                    acquiredResource.release();
                    acquiredResource = null;
                }
                const p = this.walk(theOtherEnd, relativePathStack, symlinkDepth - 1);
                if (this.depthFirst) {
                    await p;
                } else {
                    p.catch((err) => {
                        this.emit('error', err);
                    });
                }
            }
        } else {
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

    async *iterWalk(thePath: string = this.origPath, relativePathStack: string[] = [this.rootPrefix], symlinkDepth = this.symlinkDepth): AsyncGenerator<{
        type: 'dir' | 'file' | 'symlink' | 'other',
        result: WalkEntity
    }> {
        const absPath = thePath === this.origPath ? await fsp.realpath(thePath) : thePath;
        const curStat: Stats = await fsp.lstat(absPath);

        const result: any = {
            stats: curStat
        };

        result.path = absPath;
        const rPathVecs = _.compact(relativePathStack);
        result.relativePath = rPathVecs.length ? pathModule.join(...rPathVecs) : '';

        const downStreams = [];

        if (curStat.isFile()) {
            yield { type: 'file', result };
        } else if (curStat.isDirectory()) {
            yield { type: 'dir', result };
            const fList = await fsp.readdir(absPath);
            for (const fName of fList) {
                const downStream = this.iterWalk(pathModule.join(absPath, fName), [...relativePathStack, fName], symlinkDepth);
                if (this.depthFirst) {
                    yield* downStream;
                } else {
                    downStreams.push(downStream);
                }
            }
        } else if (curStat.isSymbolicLink()) {
            yield { type: 'symlink', result };
            if (this.followSymink && symlinkDepth > 0) {
                const linkContent = await fsp.readlink(absPath);
                let theOtherEnd;
                const linkContentString = linkContent;
                if (pathModule.isAbsolute(linkContentString)) {
                    theOtherEnd = linkContent;
                } else {
                    theOtherEnd = await fsp.realpath(pathModule.join(absPath, linkContent));
                }
                const downStream = this.iterWalk(theOtherEnd, relativePathStack, symlinkDepth - 1);
                if (this.depthFirst) {
                    yield* downStream;
                } else {
                    downStreams.push(downStream);
                }
            }
        } else {
            yield { type: 'other', result };
        }

        if (downStreams.length) {
            for (const downStream of downStreams) {
                yield* downStream;
            }
        }

        return;
    }
}

export interface FsWalk extends EventEmitter {
    on(event: 'file', listener: (entry: WalkEntity) => void): this;
    on(event: 'symlink', listener: (entry: WalkEntity) => void): this;
    on(event: 'dir', listener: (entry: WalkEntity) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
}
