import { AsyncService } from "./async-service";
import pino from 'pino';




export abstract class AbstractLogger extends AsyncService {

    abstract logger: { [k: string]: Function };

    constructor(...whatever: any[]) {
        super(...whatever);
    }

    init() {
        this.dependencyReady().then(() => this.emit('ready'));
    }

    error(obj?: object, message?: string): void;
    error(message?: string): void;
    error(...whatever: any[]) {
        return this.logger.error(...whatever);
    }


    warn(obj?: object, message?: string): void;
    warn(message?: string): void;
    warn(...whatever: any[]) {
        return this.logger.warn(...whatever);
    }


    info(obj?: object, message?: string): void;
    info(message?: string): void;
    info(...whatever: any[]) {
        return this.logger.info(...whatever);
    }


    debug(obj?: object, message?: string): void;
    debug(message?: string): void;
    debug(...whatever: any[]) {
        return this.logger.debug(...whatever);
    }
}


export class DevLogger extends AbstractLogger {

    logger!: pino.Logger;

    init() {
        this.logger = pino({prettyPrint: {
            colorize: true
        }});
        this.dependencyReady().then(() => this.emit('ready'));
    }

}
