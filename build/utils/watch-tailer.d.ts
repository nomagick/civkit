/// <reference types="node" />
import fs from 'fs';
import { EventEmitter } from 'events';
export declare class FileTailer extends EventEmitter {
    path: string;
    private options?;
    istat?: fs.Stats;
    fd?: number;
    inode?: number;
    offset: number;
    watcher?: fs.FSWatcher;
    fReadBuf: Buffer;
    decodeStream?: NodeJS.ReadWriteStream;
    textChunks: string[];
    _shutdown: boolean;
    _aftershots?: NodeJS.Timeout;
    _clearAftershots?: NodeJS.Timeout;
    constructor(path: string, options?: {
        encoding?: BufferEncoding | undefined;
        fromStart?: boolean | undefined;
    } | undefined);
    prepareFd(fstat: fs.Stats, tailMode: boolean): Promise<void>;
    drainFd(): Promise<void>;
    close(): Promise<void>;
    invokeAftershots(interval?: number): void;
    refreshClearAftershots(setToInterval?: number): void;
}
//# sourceMappingURL=watch-tailer.d.ts.map