import { addAbortSignal, Duplex, Readable, ReadableOptions } from 'stream';

export enum PROGRESS_TYPE {
    INIT = 'init',

    START = 'start',
    CONSOLE = 'console',
    PROGRESS = 'progress',
    DONE = 'done',

    ERROR = 'error',
    COMPLETE = 'complete',

}

export interface ProgressEvent {
    type: PROGRESS_TYPE;
    subject?: string;
    payload?: any;
    [k: string]: any;
}

export class ProgressStream extends Duplex {
    abortController = new AbortController();

    protected lastError?: Error;
    constructor(options?: ReadableOptions) {
        super({ ...options, objectMode: true });

        this.abortController.signal.addEventListener('abort', () => this.emit('abort'));

        addAbortSignal(this.abortController.signal, this);

        this.on('error', (err) => {
            this.lastError = err;
        });
    }

    abort() {
        this.abortController.abort();
    }

    override _read() {
        // ProgressStream is fully passive.

        return;
    }

    override _write(chunk: ProgressEvent, _encoding: BufferEncoding, callback: (error?: Error | null) => void
    ) {
        if (chunk === null) {
            return;
        }

        this.push(chunk);
        callback(null);
    }

    assertMayContinue(): true {
        if (this.writable) {
            return true;
        }

        if (this.lastError) {
            throw this.lastError;
        }

        throw new Error('Should not continue: this stream has ended');
    }


    getProgressCompanion(subject: string) {
        this.assertMayContinue();

        const theCompanion = {
            start: (payload?: any, etc?: object) =>
                this.write({ type: PROGRESS_TYPE.START, subject, payload, ...etc }),
            console: (text: string, source: string = 'stdout', etc?: object) =>
                this.write({ type: PROGRESS_TYPE.CONSOLE, subject, payload: text, source, ...etc }),
            progress: (percentage: number, etc?: object) =>
                this.write({ type: PROGRESS_TYPE.PROGRESS, subject, payload: percentage, ...etc }),
            done: (payload?: any, etc?: object) =>
                this.write({ type: PROGRESS_TYPE.DONE, subject, payload, ...etc }),
            error: (error: Error | string, etc?: object) =>
                this.write({ type: PROGRESS_TYPE.ERROR, subject, payload: `${error.toString()}`, ...etc }),
        };

        return theCompanion;
    }

}


export interface ProgressStream {
    push(chunk: ProgressEvent): boolean;
    write(chunk: ProgressEvent, callback?: (error: Error | null | undefined) => void): boolean;
    write(
        chunk: ProgressEvent,
        encoding: BufferEncoding,
        callback?: (error: Error | null | undefined) => void
    ): boolean;

    end(cb?: () => void): void;
    end(chunk: ProgressEvent, cb?: () => void): void;

    on(event: 'close', listener: () => void): this;
    on(event: 'data', listener: (chunk: ProgressEvent) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'pause', listener: () => void): this;
    on(event: 'readable', listener: () => void): this;
    on(event: 'resume', listener: () => void): this;
    on(event: 'drain', listener: () => void): this;
    on(event: 'finish', listener: () => void): this;
    on(event: 'pipe', listener: (src: Readable) => void): this;
    on(event: 'unpipe', listener: (src: Readable) => void): this;
    on(event: 'abort', listener: (src: Readable) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;

    once(event: 'close', listener: () => void): this;
    once(event: 'data', listener: (chunk: ProgressEvent) => void): this;
    once(event: 'end', listener: () => void): this;
    once(event: 'error', listener: (err: Error) => void): this;
    once(event: 'pause', listener: () => void): this;
    once(event: 'readable', listener: () => void): this;
    once(event: 'resume', listener: () => void): this;
    once(event: 'drain', listener: () => void): this;
    once(event: 'finish', listener: () => void): this;
    once(event: 'pipe', listener: (src: Readable) => void): this;
    once(event: 'unpipe', listener: (src: Readable) => void): this;
    once(event: 'abort', listener: (src: Readable) => void): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this;

}
