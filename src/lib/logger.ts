import { AsyncService } from './async-service';
import pino from 'pino';

export type LoggerOptions = pino.LoggerOptions;
export type LoggerInterface = pino.Logger;

const logLevels = [
    'fatal',
    'error',
    'warn',
    'info',
    'debug',
    'trace'
];

function wipeBehindPinoFunction(level: string, binding?: object) {

    return function patchedLogger(this: AbstractLogger, ...args: any[]) {
        const thePino = this.logger;
        const logFunc = thePino[level];
        const texts: string[] = [];
        const objects: object[] = [];

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

        return logFunc.call(thePino, Object.assign({}, binding, ...objects), texts.join(' '));
    };

}

export abstract class AbstractLogger extends AsyncService {
    abstract logger: LoggerInterface;
    abstract loggerOptions: LoggerOptions;

    constructor(...whatever: any[]) {
        super(...whatever);
    }

    override init(stream?: pino.DestinationStream) {
        this.logger = pino(this.loggerOptions, stream as any);
    }

    child(bindings: object) {
        const childLogger: LoggerInterface = {} as any;

        Object.defineProperty(childLogger, 'logger', {
            get: () => this.logger
        });

        for (const level of logLevels) {
            childLogger[level] = wipeBehindPinoFunction(level, bindings);
        }

        return childLogger;
    }
}

for (const level of logLevels) {
    (AbstractLogger.prototype as any)[level] = wipeBehindPinoFunction(level);
}

export interface AbstractLogger {
    error(message: string, ...args: any[]): void;
    error(obj: object, message?: string, ...args: any[]): void;

    warn(message: string, ...args: any[]): void;
    warn(obj: object, message?: string, ...args: any[]): void;


    info(message: string, ...args: any[]): void;
    info(obj: object, message?: string, ...args: any[]): void;

    debug(message: string, ...args: any[]): void;
    debug(obj: object, message?: string, ...args: any[]): void;

    fatal(message: string, ...args: any[]): void;
    fatal(obj: object, message?: string, ...args: any[]): void;

    trace(message: string, ...args: any[]): void;
    trace(obj: object, message?: string, ...args: any[]): void;
}

