import { createHash, createHmac, BinaryToTextEncoding } from 'crypto';
import { Readable as ReadableStream } from 'stream';

import nodeObjectHash from 'node-object-hash';
export class HashManager<T extends string | Buffer = string> {
    protected algorithm: string = 'sha256';
    protected outputFormat: BinaryToTextEncoding | 'buffer' = 'hex';

    constructor(algorithm?: string, outputFormat?: BinaryToTextEncoding | 'buffer') {

        if (algorithm) {
            this.algorithm = algorithm;
        }
        if (outputFormat) {
            this.outputFormat = outputFormat;
        }
    }

    hash<P extends string | Buffer = T>(target: string | Buffer | ArrayBuffer, outputFormat = this.outputFormat): P {
        const hashObj = createHash(this.algorithm);
        hashObj.update(target as Buffer);
        if (outputFormat && outputFormat !== 'buffer') {
            return hashObj.digest(outputFormat) as P;
        } else {
            return hashObj.digest() as P;
        }
    }

    hashStream<P extends string | Buffer = T>(target: ReadableStream, outputFormat = this.outputFormat): Promise<P> {
        const hashObj = createHash(this.algorithm);

        return new Promise((resolve, reject) => {
            target.on('data', (chunk) => hashObj.update(chunk));
            target.on('end', () => resolve(outputFormat && outputFormat !== 'buffer' ? hashObj.digest(outputFormat) as P : hashObj.digest() as P));
            target.on('error', reject);
        });
    }
}

export class HMacManager<T extends string | Buffer = string> {
    protected algorithm: string = 'sha256';
    protected outputFormat: BinaryToTextEncoding | 'buffer' = 'hex';

    key: string;

    constructor(key: string, algorithm?: string, outputFormat?: BinaryToTextEncoding | 'buffer') {
        this.key = key;

        if (algorithm) {
            this.algorithm = algorithm;
        }
        if (outputFormat) {
            this.outputFormat = outputFormat;
        }
    }

    sign<P extends string | Buffer = T>(target: string | Buffer | ArrayBuffer, outputFormat = this.outputFormat): P {
        const hashObj = createHmac(this.algorithm, this.key);
        hashObj.update(target as Buffer);
        if (outputFormat && outputFormat !== 'buffer') {
            return hashObj.digest(outputFormat) as P;
        } else {
            return hashObj.digest() as P;
        }
    }

    signStream(target: ReadableStream): Promise<Buffer | string>;
    signStream(target: ReadableStream, outputFormat: BinaryToTextEncoding): Promise<string>;
    signStream(target: ReadableStream, outputFormat: undefined | 'buffer'): Promise<Buffer>;
    signStream<P extends string | Buffer = T>(target: ReadableStream, outputFormat = this.outputFormat): Promise<P> {
        const hashObj = createHmac(this.algorithm, this.key);

        return new Promise((resolve, reject) => {
            target.on('data', (chunk) => hashObj.update(chunk));
            target.on('end', () => resolve(outputFormat && outputFormat !== 'buffer' ? hashObj.digest(outputFormat) as P : hashObj.digest() as P));
            target.on('error', reject);
        });
    }
}

const COLUMN_INSERTION_FACTOR = 2;

export class SaltedHashManager<T extends string | Buffer = Buffer> extends HashManager<T> {
    protected seedHash: Buffer;
    protected seed: string;

    constructor(seed: string, algorithm: string = 'sha256', outputFormat: BinaryToTextEncoding | 'buffer' = 'hex') {
        super(algorithm, outputFormat);
        this.seed = seed;
        this.seedHash = super.hash(seed, 'buffer');
    }

    hash<P extends string | Buffer = T>(target: string | Buffer | ArrayBuffer, outputFormat = this.outputFormat): P {
        const targetHash = super.hash<Buffer>(target, 'buffer');
        const fusionBuffer = Buffer.alloc(targetHash.length + this.seedHash.length);
        this.seedHash.forEach((vlu, idx) => {
            fusionBuffer[COLUMN_INSERTION_FACTOR * idx] = vlu;
        });
        targetHash.forEach((vlu, idx) => {
            fusionBuffer[COLUMN_INSERTION_FACTOR * idx + 1] = vlu;
        });
        if (outputFormat && outputFormat !== 'buffer') {
            return super.hash(fusionBuffer, outputFormat) as P;
        } else {
            return super.hash(fusionBuffer) as P;
        }
    }

    hashStream<P extends string | Buffer = T>(target: ReadableStream, outputFormat = this.outputFormat): Promise<P> {
        return super.hashStream<Buffer>(target, undefined).then((r) => {
            const targetHash = r;
            const fusionBuffer = Buffer.alloc(targetHash.length + this.seedHash.length);
            this.seedHash.forEach((vlu, idx) => {
                fusionBuffer[COLUMN_INSERTION_FACTOR * idx] = vlu;
            });
            targetHash.forEach((vlu, idx) => {
                fusionBuffer[COLUMN_INSERTION_FACTOR * idx + 1] = vlu;
            });
            if (outputFormat && outputFormat !== 'buffer') {
                return super.hash<P>(fusionBuffer, outputFormat);
            } else {
                return super.hash<P>(fusionBuffer);
            }
        });
    }
}


const objHasher = nodeObjectHash();

export function objHashMd5B64Of(obj: any) {
    return objHasher.hash(obj, { enc: 'base64', alg: 'md5' });
}
