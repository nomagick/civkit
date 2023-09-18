import { AsyncService } from './async-service';
import { hostname } from 'os';
import { Writable } from 'stream';
import { getTraceCtx } from './async-context';

const logLevels = {
    FATAL: 'fatal',
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug',
    TRACE: 'trace'
} as const;


export abstract class AbstractLogger extends AsyncService {
    abstract _targetStream: Writable;

    bindings: Record<string, any> = {
        pid: process.pid,
        host: hostname() || 'unknown',
    };

    constructor(...whatever: any[]) {
        super(...whatever);
    }

    override init(stream?: Writable) {
        this._targetStream = stream || process.stderr;
    }

    log(...args: any[]) {
        const texts: string[] = [];
        const objects: object[] = [this.bindings];

        let errCounter = 0;
        for (const x of args) {
            if (!x) {
                continue;
            }
            if (typeof x === 'string') {
                texts.push(x);
            } else {
                if (x instanceof Error) {
                    objects.push({ [`err${errCounter || ''}`]: x });
                    errCounter++;
                }
                objects.push(x);
            }
        }

        const traceCtx = getTraceCtx();
        if (traceCtx) {
            objects.push({
                traceId: traceCtx.traceId,
                traceDt: Date.now() - traceCtx.traceT0!.getTime()
            });
        }

        return this._targetStream.write(Object.assign({ message: texts.join(' '), date: new Date() }, ...objects));
    }

    child(bindings: object) {
        const childLogger = Object.create(this) as this;

        childLogger.bindings = Object.assign({}, this.bindings, bindings);

        return childLogger;
    }
}

for (const level of Object.values(logLevels)) {
    AbstractLogger.prototype[level] = function (...args: any[]) {
        return this.log({ level }, ...args);
    };
}

export interface LoggerInterface {
    error(message: string, ...args: any[]): void;
    error(obj: unknown, message?: string, ...args: any[]): void;

    warn(message: string, ...args: any[]): void;
    warn(obj: unknown, message?: string, ...args: any[]): void;

    info(message: string, ...args: any[]): void;
    info(obj: unknown, message?: string, ...args: any[]): void;

    debug(message: string, ...args: any[]): void;
    debug(obj: unknown, message?: string, ...args: any[]): void;

    fatal(message: string, ...args: any[]): void;
    fatal(obj: unknown, message?: string, ...args: any[]): void;

    trace(message: string, ...args: any[]): void;
    trace(obj: unknown, message?: string, ...args: any[]): void;

    log(message: string, ...args: any[]): void;
    log(obj: unknown, message?: string, ...args: any[]): void;

    child(binding: object): LoggerInterface;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface AbstractLogger extends LoggerInterface { }
