/// <reference types="node" />
import { BinaryToTextEncoding } from 'crypto';
import { Readable as ReadableStream } from 'stream';
export declare class HashManager<T extends string | Buffer = string> {
    protected algorithm: string;
    protected outputFormat: BinaryToTextEncoding | 'buffer';
    constructor(algorithm?: string, outputFormat?: BinaryToTextEncoding | 'buffer');
    hash<P extends string | Buffer = T>(target: string | Buffer | ArrayBuffer, outputFormat?: "buffer" | BinaryToTextEncoding): P;
    hashStream<P extends string | Buffer = T>(target: ReadableStream, outputFormat?: "buffer" | BinaryToTextEncoding): Promise<P>;
}
export declare class HMacManager<T extends string | Buffer = string> {
    protected algorithm: string;
    protected outputFormat: BinaryToTextEncoding | 'buffer';
    key: string;
    constructor(key: string, algorithm?: string, outputFormat?: BinaryToTextEncoding | 'buffer');
    sign<P extends string | Buffer = T>(target: string | Buffer | ArrayBuffer, outputFormat?: "buffer" | BinaryToTextEncoding): P;
    signStream(target: ReadableStream): Promise<Buffer | string>;
    signStream(target: ReadableStream, outputFormat: BinaryToTextEncoding): Promise<string>;
    signStream(target: ReadableStream, outputFormat: undefined | 'buffer'): Promise<Buffer>;
}
export declare class SaltedHashManager<T extends string | Buffer = Buffer> extends HashManager<T> {
    protected seedHash: Buffer;
    protected seed: string;
    constructor(seed: string, algorithm?: string, outputFormat?: BinaryToTextEncoding | 'buffer');
    hash<P extends string | Buffer = T>(target: string | Buffer | ArrayBuffer, outputFormat?: "buffer" | BinaryToTextEncoding): P;
    hashStream<P extends string | Buffer = T>(target: ReadableStream, outputFormat?: "buffer" | BinaryToTextEncoding): Promise<P>;
}
export declare function objHashMd5B64Of(obj: any): string;
//# sourceMappingURL=hash.d.ts.map