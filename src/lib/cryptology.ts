import { createCipheriv, createDecipheriv } from 'crypto';
import { HashManager } from './hash';

const SHA256BINHASHER = new HashManager('sha256', 'buffer');

export function simpleAES256Encrypt(data: Buffer, password: string | Buffer) {
    const key = SHA256BINHASHER.hash(password);
    const cipher = createCipheriv('aes-256-cbc', key, key.slice(0, 16));
    cipher.setAutoPadding(true);
    const r = cipher.update(data);

    return Buffer.concat([r, cipher.final()]);
}

export function simpleAES256Decrypt(data: Buffer, password: string | Buffer) {
    const key = SHA256BINHASHER.hash(password);
    const decipher = createDecipheriv('aes-256-cbc', key, key.slice(0, 16));
    decipher.setAutoPadding(true);
    const r = decipher.update(data);

    return Buffer.concat([r, decipher.final()]);
}
