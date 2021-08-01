import jschardet from 'jschardet';
import iconv from 'iconv-lite';

export function detectEncoding(buf: Buffer) {

    const result = jschardet.detect(buf);

    if (result.confidence >= 0.90) {
        return result.encoding;
    }

    return undefined;
}


export function decode(buf: Buffer, encoding?: string): string {
    if (encoding && (typeof encoding === 'string')) {
        if (!iconv.encodingExists(encoding)) {
            throw new Error(`Unsupported encoding: ${encoding}`);
        }

        return iconv.decode(buf, encoding);
    }

    return decode(buf, detectEncoding(buf) || 'utf-8');
}

export function decodeWithHintEncoding(buf: Buffer, hintEncoding: string) {
    return decode(buf, detectEncoding(buf) || hintEncoding);
}
