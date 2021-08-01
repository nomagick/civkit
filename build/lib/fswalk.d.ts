/// <reference types="node" />
import { EventEmitter } from 'events';
import { Stats } from 'fs';
import { PromiseThrottle } from './throttle';
export interface WalkOptions {
    throttle?: number;
    symlinkDepth?: number;
    followSymlink?: boolean;
    autoDecode?: string | boolean;
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
export declare class BFsWalk extends EventEmitter {
    static walk(fpath: string, options?: WalkOptions): BFsWalk;
    static walkOut(fpath: string, options?: WalkOptions): Promise<WalkOutEntity[]>;
    origPath: Buffer;
    followSymink: boolean;
    autoDecode: boolean | string;
    symlinkDepth: number;
    _kInstances: number;
    throttle: PromiseThrottle;
    depthFirst: boolean;
    rootPrefix: Buffer;
    constructor(fpath: string | Buffer, _options?: WalkOptions);
    bwalk(thePath?: string | Buffer, relativePathStack?: Buffer[], symlinkDepth?: number): Promise<void>;
}
export interface BFsWalk extends EventEmitter {
    on(event: 'file', listener: (entry: WalkEntity) => void): this;
    on(event: 'symlink', listener: (entry: WalkEntity) => void): this;
    on(event: 'dir', listener: (entry: WalkEntity) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
}
//# sourceMappingURL=fswalk.d.ts.map