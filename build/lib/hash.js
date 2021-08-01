"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.objHashMd5B64Of = exports.SaltedHashManager = exports.HMacManager = exports.HashManager = void 0;
const tslib_1 = require("tslib");
const crypto_1 = require("crypto");
const node_object_hash_1 = tslib_1.__importDefault(require("node-object-hash"));
class HashManager {
    constructor(algorithm, outputFormat) {
        this.algorithm = 'sha256';
        this.outputFormat = 'hex';
        if (algorithm) {
            this.algorithm = algorithm;
        }
        if (outputFormat) {
            this.outputFormat = outputFormat;
        }
    }
    hash(target, outputFormat = this.outputFormat) {
        const hashObj = crypto_1.createHash(this.algorithm);
        hashObj.update(target);
        if (outputFormat && outputFormat !== 'buffer') {
            return hashObj.digest(outputFormat);
        }
        else {
            return hashObj.digest();
        }
    }
    hashStream(target, outputFormat = this.outputFormat) {
        const hashObj = crypto_1.createHash(this.algorithm);
        return new Promise((resolve, reject) => {
            target.on('data', (chunk) => hashObj.update(chunk));
            target.on('end', () => resolve(outputFormat && outputFormat !== 'buffer' ? hashObj.digest(outputFormat) : hashObj.digest()));
            target.on('error', reject);
        });
    }
}
exports.HashManager = HashManager;
class HMacManager {
    constructor(key, algorithm, outputFormat) {
        this.algorithm = 'sha256';
        this.outputFormat = 'hex';
        this.key = key;
        if (algorithm) {
            this.algorithm = algorithm;
        }
        if (outputFormat) {
            this.outputFormat = outputFormat;
        }
    }
    sign(target, outputFormat = this.outputFormat) {
        const hashObj = crypto_1.createHmac(this.algorithm, this.key);
        hashObj.update(target);
        if (outputFormat && outputFormat !== 'buffer') {
            return hashObj.digest(outputFormat);
        }
        else {
            return hashObj.digest();
        }
    }
    signStream(target, outputFormat = this.outputFormat) {
        const hashObj = crypto_1.createHmac(this.algorithm, this.key);
        return new Promise((resolve, reject) => {
            target.on('data', (chunk) => hashObj.update(chunk));
            target.on('end', () => resolve(outputFormat && outputFormat !== 'buffer' ? hashObj.digest(outputFormat) : hashObj.digest()));
            target.on('error', reject);
        });
    }
}
exports.HMacManager = HMacManager;
const COLUMN_INSERTION_FACTOR = 2;
class SaltedHashManager extends HashManager {
    constructor(seed, algorithm = 'sha256', outputFormat = 'hex') {
        super(algorithm, outputFormat);
        this.seed = seed;
        this.seedHash = super.hash(seed, 'buffer');
    }
    hash(target, outputFormat = this.outputFormat) {
        const targetHash = super.hash(target, 'buffer');
        const fusionBuffer = Buffer.alloc(targetHash.length + this.seedHash.length);
        this.seedHash.forEach((vlu, idx) => {
            fusionBuffer[COLUMN_INSERTION_FACTOR * idx] = vlu;
        });
        targetHash.forEach((vlu, idx) => {
            fusionBuffer[COLUMN_INSERTION_FACTOR * idx + 1] = vlu;
        });
        if (outputFormat && outputFormat !== 'buffer') {
            return super.hash(fusionBuffer, outputFormat);
        }
        else {
            return super.hash(fusionBuffer);
        }
    }
    hashStream(target, outputFormat = this.outputFormat) {
        return super.hashStream(target, undefined).then((r) => {
            const targetHash = r;
            const fusionBuffer = Buffer.alloc(targetHash.length + this.seedHash.length);
            this.seedHash.forEach((vlu, idx) => {
                fusionBuffer[COLUMN_INSERTION_FACTOR * idx] = vlu;
            });
            targetHash.forEach((vlu, idx) => {
                fusionBuffer[COLUMN_INSERTION_FACTOR * idx + 1] = vlu;
            });
            if (outputFormat && outputFormat !== 'buffer') {
                return super.hash(fusionBuffer, outputFormat);
            }
            else {
                return super.hash(fusionBuffer);
            }
        });
    }
}
exports.SaltedHashManager = SaltedHashManager;
const objHasher = node_object_hash_1.default();
function objHashMd5B64Of(obj) {
    return objHasher.hash(obj, { enc: 'base64', alg: 'md5' });
}
exports.objHashMd5B64Of = objHashMd5B64Of;
//# sourceMappingURL=hash.js.map