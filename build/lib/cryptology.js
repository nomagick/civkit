"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.simpleAES256Decrypt = exports.simpleAES256Encrypt = void 0;
const crypto_1 = require("crypto");
const hash_1 = require("./hash");
const SHA256BINHASHER = new hash_1.HashManager('sha256', 'buffer');
function simpleAES256Encrypt(data, password) {
    const key = SHA256BINHASHER.hash(password);
    const cipher = crypto_1.createCipheriv('aes-256-cbc', key, key.slice(0, 16));
    cipher.setAutoPadding(true);
    const r = cipher.update(data);
    return Buffer.concat([r, cipher.final()]);
}
exports.simpleAES256Encrypt = simpleAES256Encrypt;
function simpleAES256Decrypt(data, password) {
    const key = SHA256BINHASHER.hash(password);
    const decipher = crypto_1.createDecipheriv('aes-256-cbc', key, key.slice(0, 16));
    decipher.setAutoPadding(true);
    const r = decipher.update(data);
    return Buffer.concat([r, decipher.final()]);
}
exports.simpleAES256Decrypt = simpleAES256Decrypt;
//# sourceMappingURL=cryptology.js.map