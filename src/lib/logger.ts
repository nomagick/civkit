import { AsyncService } from './async-service';
import pino from 'pino';


export abstract class AbstractLogger extends AsyncService {

    abstract logger: pino.Logger;

    constructor(...whatever: any[]) {
        super(...whatever);
    }

    init() {
        this.dependencyReady().then(() => this.emit('ready'));
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

export class DevLogger extends AbstractLogger {

    logger!: pino.Logger;

    init() {
        this.logger = pino({prettyPrint: {
            colorize: true
        }});
        this.dependencyReady().then(() => this.emit('ready'));
    }

}
