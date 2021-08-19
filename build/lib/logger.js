"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DevLogger = exports.AbstractLogger = void 0;
const tslib_1 = require("tslib");
const async_service_1 = require("./async-service");
const pino_1 = tslib_1.__importDefault(require("pino"));
class AbstractLogger extends async_service_1.AsyncService {
    constructor(...whatever) {
        super(...whatever);
    }
    init() {
        this.dependencyReady().then(() => this.emit('ready'));
    }
    error(...whatever) {
        return this.logger.error(...whatever);
    }
    warn(...whatever) {
        return this.logger.warn(...whatever);
    }
    info(...whatever) {
        return this.logger.info(...whatever);
    }
    debug(...whatever) {
        return this.logger.debug(...whatever);
    }
}
exports.AbstractLogger = AbstractLogger;
class DevLogger extends AbstractLogger {
    init() {
        this.logger = pino_1.default({ prettyPrint: {
                colorize: true
            } });
        this.dependencyReady().then(() => this.emit('ready'));
    }
}
exports.DevLogger = DevLogger;
//# sourceMappingURL=logger.js.map