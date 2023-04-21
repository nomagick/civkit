import pino from 'pino';
import { Writable } from 'stream';
import { AbstractLogger } from './logger';

class PinoTargetStream extends Writable {
    constructor(protected pino: pino.Logger) {
        super({ objectMode: true });
    }

    override _write(chunk: Record<string, any>, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        const func = Reflect.get(this.pino, chunk.level || 'debug') || this.pino.debug;
        (chunk);
        func.call(this.pino, chunk, chunk.message);
        callback();
    }
}

export abstract class AbstractPinoLogger extends AbstractLogger {
    abstract logger: pino.Logger;
    abstract loggerOptions: pino.LoggerOptions;
    _targetStream!: PinoTargetStream;

    override init(stream?: pino.DestinationStream) {
        this.logger = pino(this.loggerOptions, stream as any);

        return super.init(new PinoTargetStream(this.logger));
    }

}
