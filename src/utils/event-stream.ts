import { Transform, TransformCallback, TransformOptions } from 'stream';


export class EventStream extends Transform {
    constructor(options?: TransformOptions) {
        super({ ...options, writableObjectMode: true, decodeStrings: false });
    }

    override _transform(data: any, _encoding: string, callback: TransformCallback) {

        if (typeof data === 'object') {
            const objKeys = Array.from(Object.keys(data));
            if (objKeys.length === 2 && objKeys.includes('event') && objKeys.includes('data')) {
                this.push(Buffer.from(`event: ${data.event}\n`, 'utf-8'));
                this.push(Buffer.from(`data: ${JSON.stringify(data.data)}\n`, 'utf-8'));
                this.push(Buffer.from('\n', 'utf-8'));

                return callback();
            }
        }

        this.push(Buffer.from(`data: ${JSON.stringify(data)}\n`, 'utf-8'));
        this.push(Buffer.from('\n', 'utf-8'));

        return callback();
    }
}
