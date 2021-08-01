/// <reference types="node" />
import { Readable } from 'stream';
import { Stats } from 'fs';
import { Deferred } from './defer';
import { MIMEVec } from './mime';
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
export declare class ResolvedFile {
    mimeType: string;
    mimeVec: MIMEVec;
    fileName: string;
    size: number;
    sha256Sum?: string;
    filePath: string;
    createReadStream(): import("fs").ReadStream;
    unlink(): Promise<unknown>;
}
export interface HashedFile extends ResolvedFile {
    sha256Sum: string;
}
export declare class FancyFile {
    protected static _keys: string[];
    protected static _fromLocalFile(filePath: string, partialFile?: PartialFile): FancyFile;
    protected static _fromStream(readable: Readable, tmpFilePath: string, partialFile?: PartialFile): FancyFile;
    protected static _fromBuffer(buff: Buffer, tmpFilePath: string, partialFile?: PartialFile): FancyFile;
    static auto(filePath: string, partialFile?: PartialFile): FancyFile;
    static auto(readable: Readable | Buffer | string, tmpFilePath: string, partialFile?: PartialFile): FancyFile;
    static auto(partialFile: PartialFile, tmpFilePath?: string): FancyFile;
    fstat?: Stats;
    protected _notSupposedToUnlink: boolean;
    protected _deferreds: Map<string, Deferred<any>>;
    protected _all?: Promise<ResolvedFile>;
    protected _ensureDeferred(key: string): any;
    protected _resolveDeferred(key: string, value: any): any;
    protected _rejectDeferred(key: string, err: Error): any;
    protected _rejectAll(err: Error, keys?: string[]): void;
    get mimeType(): any;
    get mimeVec(): string | MIMEVec | null | Promise<MIMEVec | null>;
    set mimeVec(_mimeVec: string | MIMEVec | null | Promise<MIMEVec | null>);
    get fileName(): string | Promise<string>;
    set fileName(fileNameText: string | Promise<string>);
    get size(): number | Promise<number>;
    set size(sizeNumber: number | Promise<number>);
    get sha256Sum(): string | Promise<string>;
    set sha256Sum(sha256SumText: string | Promise<string>);
    get filePath(): string | Promise<string>;
    set filePath(filePathText: string | Promise<string>);
    get all(): Promise<ResolvedFile>;
    get ready(): string | Promise<string>;
    resolve(): Promise<ResolvedFile>;
    createReadStream(options?: any): Promise<import("fs").ReadStream>;
    unlink(forced?: boolean): Promise<void>;
}
//# sourceMappingURL=fancy-file.d.ts.map