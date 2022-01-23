import { Transform, TransformCallback, TransformOptions } from 'stream';


export class NDJsonStream extends Transform {
    constructor(options?: TransformOptions) {
        super({ ...options, objectMode: true, decodeStrings: false });
    }

    override _transform(data: any, _encoding: string, callback: TransformCallback) {
        this.push(Buffer.from(JSON.stringify(data), 'utf-8'));

        this.push('\n');

        return callback();
    }
}
