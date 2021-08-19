import { AsyncService } from "./async-service";
import pino from 'pino';
export declare abstract class AbstractLogger extends AsyncService {
    abstract logger: {
        [k: string]: Function;
    };
    constructor(...whatever: any[]);
    init(): void;
    error(obj?: object, message?: string): void;
    error(message?: string): void;
    warn(obj?: object, message?: string): void;
    warn(message?: string): void;
    info(obj?: object, message?: string): void;
    info(message?: string): void;
    debug(obj?: object, message?: string): void;
    debug(message?: string): void;
}
export declare class DevLogger extends AbstractLogger {
    logger: pino.Logger;
    init(): void;
}
//# sourceMappingURL=logger.d.ts.map