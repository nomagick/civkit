/* eslint-disable @typescript-eslint/no-magic-numbers */

const RFC4648 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Buffer) {
    let bits = 0;
    let value = 0;
    const outputArr = [];

    for (let i = 0; i < data.byteLength; i++) {
        value = (value << 8) | data.readUInt8(i);
        bits += 8;

        while (bits >= 5) {
            outputArr.push(RFC4648[(value >>> (bits - 5)) & 31]);
            bits -= 5;
        }
    }

    if (bits > 0) {
        outputArr.push(RFC4648[(value << (5 - bits)) & 31]);
    }

    while ((outputArr.length % 8) !== 0) {
        outputArr.push('=');
    }

    return outputArr.join('');
}
