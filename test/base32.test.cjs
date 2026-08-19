const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { base32Encode } = require('../build/utils/base32.js');

describe('base32Encode', () => {
    it('encodes empty buffers without padding', () => {
        assert.equal(base32Encode(Buffer.alloc(0)), '');
    });

    it('encodes RFC 4648 test vectors', () => {
        const vectors = [
            ['', ''],
            ['f', 'MY======'],
            ['fo', 'MZXQ===='],
            ['foo', 'MZXW6==='],
            ['foob', 'MZXW6YQ='],
            ['fooba', 'MZXW6YTB'],
            ['foobar', 'MZXW6YTBOI======'],
        ];

        for (const [input, expected] of vectors) {
            assert.equal(base32Encode(Buffer.from(input, 'utf8')), expected);
        }
    });
});
