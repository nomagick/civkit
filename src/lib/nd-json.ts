import { Transform, TransformCallback, TransformOptions } from 'stream';
import { TPM } from '../civ-rpc/meta';


@TPM({
    contentType: 'application/x-ndjson; charset=UTF-8'
})
export class NDJsonStream extends Transform {
    constructor(options?: TransformOptions) {
        super({ ...options, writableObjectMode: true, decodeStrings: false });
    }

    override _transform(data: any, _encoding: string, callback: TransformCallback) {
        this.push(Buffer.from(JSON.stringify(data), 'utf-8'));

        this.push(Buffer.from('\n', 'utf-8'));

        return callback();
    }
}

export class NDJsonDecodeStream extends Transform {

    textChunks: string[] = [];

    constructor(options?: TransformOptions) {
        super({ ...options, readableObjectMode: true, decodeStrings: true });
    }

    override _transform(binaryData: string, _encoding: string, callback: TransformCallback) {
        const data = Buffer.isBuffer(binaryData) ? binaryData.toString('utf-8') : binaryData;
        const chunks = data.split('\n');
        if (chunks.length >= 2) {
            const last = chunks.pop()!;
            const first = chunks.shift();
            this.push(JSON.parse([...this.textChunks, first].join('')));
            for (const chunk of chunks) {
                this.push(JSON.parse(chunk));
            }
            this.textChunks.length = 0;
            this.textChunks.push(last);
        } else {
            this.textChunks.push(data);
        }

        return callback();
    }
}
