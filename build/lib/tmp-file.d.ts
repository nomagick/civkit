/// <reference types="node" />
import fs from 'fs';
import { Readable } from 'stream';
import { FancyFile } from './fancy-file';
export declare class TemporaryFileManger {
    protected rootDir: string;
    constructor(rootDir?: string);
    fullPath(fileName?: string): string;
    newName(): string;
    touch(): [string, Promise<number>];
    touchWithFileName(fileName: string): Promise<number>;
    alloc(): string;
    newWritableStream(fileName?: string): Promise<[string, fs.WriteStream, string]>;
    getReadableStream(fileName: string): fs.ReadStream;
    remove(fileName: string): Promise<void>;
    cacheReadable(readable: Readable, fileName?: string): FancyFile;
    cacheBuffer(buff: Buffer, fileName?: string): FancyFile;
    cacheText(str: string, fileName?: string): FancyFile;
    access(fileName: string): FancyFile;
    mkdir(dirName: string): Promise<string>;
    touchDir(): [string, Promise<string>];
    rmdir(dirName: string): Promise<void>;
}
//# sourceMappingURL=tmp-file.d.ts.map