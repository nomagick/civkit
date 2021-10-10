import { AsyncService } from './async-service';
import pino from 'pino';

export type LoggerOptions = pino.LoggerOptions;
export type LoggerInterface = pino.Logger;

export abstract class AbstractLogger extends AsyncService {

    logger!: LoggerInterface;
    abstract loggerOptions: LoggerOptions;

    constructor(...whatever: any[]) {
        super(...whatever);
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.logger = pino();
    }

    override init(stream?: pino.DestinationStream) {
        this.logger = pino(this.loggerOptions, stream as any);
    }

    error(message: string, ...args: any[]): void;
    error(obj: object, message?: string, ...args: any[]): void;
    error(...whatever: any[]) {
        return (this.logger.error as any)(...whatever);
    }


    warn(message: string, ...args: any[]): void;
    warn(obj: object, message?: string, ...args: any[]): void;
    warn(...whatever: any[]) {
        return (this.logger.warn as any)(...whatever);
    }


    info(message: string, ...args: any[]): void;
    info(obj: object, message?: string, ...args: any[]): void;
    info(...whatever: any[]) {
        return (this.logger.info as any)(...whatever);
    }


    debug(message: string, ...args: any[]): void;
    debug(obj: object, message?: string, ...args: any[]): void;
    debug(...whatever: any[]) {
        return (this.logger.info as any)(...whatever);
    }

    child(bindings: pino.Bindings) {
        return this.logger.child(bindings);
    }
}

export abstract class AbstractDevLogger extends AbstractLogger {

    loggerOptions = {
        prettyPrint: {
            colorize: true
        }
    };

}
