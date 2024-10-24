import { EventEmitter } from 'events';
import * as pathModule from 'path';
import { promises as fsp, Stats } from 'fs';
import { decodeWithHintEncoding } from './encoding';
import { PromiseThrottle } from './throttle';
import _ from 'lodash';
import type { WalkEntity, WalkOptions, WalkOutEntity } from './fswalk';
export type { WalkEntity, WalkOptions, WalkOutEntity } from './fswalk';

const bSep = Buffer.from(pathModule.sep);

export interface BWalkOptions extends WalkOptions {
    autoDecode?: string | boolean;
}

const presumedFsEncoding = process.platform === 'win32' ? 'cp936' : 'utf-8';

export class BFsWalk extends EventEmitter {

    static walk(fpath: string, options?: BWalkOptions) {
        const ins = new this(fpath, options);
        ins.bwalk();

        return ins;
    }

    static walkOut(fpath: string, options?: BWalkOptions): Promise<WalkOutEntity[]> {
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
            ins.bwalk().catch((err) => {
                reject(err);
            });
        });
    }

    origPath: Buffer;
    followSymink: boolean;
    autoDecode: boolean | string;
    symlinkDepth: number;
    _kInstances: number = 0;
    throttle: PromiseThrottle;
    depthFirst: boolean;
    rootPrefix: Buffer;
    constructor(fpath: string | Buffer, _options: BWalkOptions = {}) {
        super();
        const options: any = _.defaults(_options, {
            throttle: 10,
            symlinkDepth: 30,
            followSymlink: false,
            autoDecode: 'utf-8',
            depthFirst: true,
            rootPrefix: ''
        });
        this.rootPrefix = Buffer.from(options.rootPrefix);
        this.origPath = Buffer.from(<any>fpath);
        this.followSymink = Boolean(options.followSymlink);
        this.autoDecode = options.autoDecode ? options.autoDecode : false;
        this.throttle = new PromiseThrottle(parseInt(options.throttle));
        this.symlinkDepth = parseInt(options.symlinkDepth);
        this.depthFirst = Boolean(options.depthFirst);
    }

    async bwalk(thePath: string | Buffer = this.origPath, relativePathStack: Buffer[] = [this.rootPrefix], symlinkDepth = this.symlinkDepth) {
        this._kInstances += 1;
        let acquiredResource: any = await this.throttle.acquire();

        const absPath: Buffer = thePath === this.origPath ? await fsp.realpath(thePath, 'buffer') as any : thePath as Buffer;
        const curStat: Stats = await fsp.lstat(absPath);


        const result: any = {
            stats: curStat
        };
        if (this.autoDecode) {
            if (typeof this.autoDecode === 'string' && this.autoDecode != 'auto') {
                result.path = decodeWithHintEncoding(absPath, this.autoDecode);
                const rPathVecs = _.compact(relativePathStack.map((x) => decodeWithHintEncoding(x, this.autoDecode as string)));
                result.relativePath = rPathVecs.length ? pathModule.join(...rPathVecs) : '';
            } else {
                result.path = decodeWithHintEncoding(absPath, presumedFsEncoding);
                const rPathVecs = _.compact(relativePathStack.map((x) => decodeWithHintEncoding(x, this.autoDecode as string)));
                result.relativePath = rPathVecs.length ? pathModule.join(...rPathVecs) : '';
            }
        } else {
            result.path = absPath;
            result.relativePath = Buffer.concat([...(relativePathStack.slice(0, -1).map((x) => Buffer.concat([x, bSep]))), relativePathStack[relativePathStack.length - 1]]);
        }

        if (curStat.isFile()) {
            this.emit('file', result);

        } else if (curStat.isDirectory()) {
            this.emit('dir', result);
            const fList: Buffer[] = await fsp.readdir(absPath, 'buffer') as any;
            if (this.depthFirst && acquiredResource) {
                acquiredResource.release();
                acquiredResource = null;
            }
            for (const fName of fList) {
                const p = this.bwalk(Buffer.concat([absPath, bSep, fName]), [...relativePathStack, fName], symlinkDepth);
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
                const linkContent: Buffer = await fsp.readlink(absPath, 'buffer') as any;
                let theOtherEnd: Buffer;
                let linkContentString: string;
                if (this.autoDecode && typeof this.autoDecode === 'string' && this.autoDecode != 'auto') {
                    linkContentString = decodeWithHintEncoding(linkContent, this.autoDecode);
                } else {
                    linkContentString = decodeWithHintEncoding(linkContent, presumedFsEncoding);
                }
                if (pathModule.isAbsolute(linkContentString)) {
                    theOtherEnd = linkContent;
                } else {
                    theOtherEnd = await fsp.realpath(Buffer.concat([absPath, bSep, linkContent]), 'buffer') as any;
                }
                if (this.depthFirst && acquiredResource) {
                    acquiredResource.release();
                    acquiredResource = null;
                }
                const p = this.bwalk(theOtherEnd, relativePathStack, symlinkDepth - 1);
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

    async *iterBWalk(thePath: string | Buffer = this.origPath, relativePathStack: Buffer[] = [this.rootPrefix], symlinkDepth = this.symlinkDepth): AsyncGenerator<{
        type: 'dir' | 'file' | 'symlink' | 'other',
        result: WalkEntity
    }> {
        const absPath: Buffer = thePath === this.origPath ? await fsp.realpath(thePath, 'buffer') as any : thePath as Buffer;
        const curStat: Stats = await fsp.lstat(absPath);

        const result: any = {
            stats: curStat
        };
        if (this.autoDecode) {
            if (typeof this.autoDecode === 'string' && this.autoDecode != 'auto') {
                result.path = decodeWithHintEncoding(absPath, this.autoDecode);
                const rPathVecs = _.compact(relativePathStack.map((x) => decodeWithHintEncoding(x, this.autoDecode as string)));
                result.relativePath = rPathVecs.length ? pathModule.join(...rPathVecs) : '';
            } else {
                result.path = decodeWithHintEncoding(absPath, presumedFsEncoding);
                const rPathVecs = _.compact(relativePathStack.map((x) => decodeWithHintEncoding(x, this.autoDecode as string)));
                result.relativePath = rPathVecs.length ? pathModule.join(...rPathVecs) : '';
            }
        } else {
            result.path = absPath;
            result.relativePath = Buffer.concat([...(relativePathStack.slice(0, -1).map((x) => Buffer.concat([x, bSep]))), relativePathStack[relativePathStack.length - 1]]);
        }

        const downStreams = [];

        if (curStat.isFile()) {
            yield { type: 'file', result };
        } else if (curStat.isDirectory()) {
            yield { type: 'dir', result };
            const fList: Buffer[] = await fsp.readdir(absPath, 'buffer') as any;
            for (const fName of fList) {
                const downStream = this.iterBWalk(Buffer.concat([absPath, bSep, fName]), [...relativePathStack, fName], symlinkDepth);
                if (this.depthFirst) {
                    yield* downStream;
                } else {
                    downStreams.push(downStream);
                }
            }
        } else if (curStat.isSymbolicLink()) {
            yield { type: 'symlink', result };
            if (this.followSymink && symlinkDepth > 0) {
                const linkContent: Buffer = await fsp.readlink(absPath, 'buffer') as any;
                let theOtherEnd: Buffer;
                let linkContentString: string;
                if (this.autoDecode && typeof this.autoDecode === 'string' && this.autoDecode != 'auto') {
                    linkContentString = decodeWithHintEncoding(linkContent, this.autoDecode);
                } else {
                    linkContentString = decodeWithHintEncoding(linkContent, presumedFsEncoding);
                }
                if (pathModule.isAbsolute(linkContentString)) {
                    theOtherEnd = linkContent;
                } else {
                    theOtherEnd = await fsp.realpath(Buffer.concat([absPath, bSep, linkContent]), 'buffer') as any;
                }
                const downStream = this.iterBWalk(theOtherEnd, relativePathStack, symlinkDepth - 1);
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

export interface BFsWalk extends EventEmitter {
    on(event: 'file', listener: (entry: WalkEntity) => void): this;
    on(event: 'symlink', listener: (entry: WalkEntity) => void): this;
    on(event: 'dir', listener: (entry: WalkEntity) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
}
