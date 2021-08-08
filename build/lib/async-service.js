"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsyncService = void 0;
const events_1 = require("events");
const defer_1 = require("./defer");
const nextTickFunc = process?.nextTick || setImmediate || setTimeout;
class AsyncService extends events_1.EventEmitter {
    constructor(...argv) {
        super();
        this.__status = 'pending';
        this.__dependencies = [];
        for (const x of argv) {
            if (x instanceof AsyncService) {
                this.__dependencies.push(x);
            }
        }
        const readyDeferred = defer_1.Defer();
        this.__serviceReady = readyDeferred.promise;
        this.once('ready', () => {
            readyDeferred.resolve(this);
        });
        this.once('error', (err) => {
            readyDeferred.reject(err);
        });
        this.dependencyReady.catch((err) => this.emit('error', err));
        this.on('revoked', () => {
            this.__status = 'revoked';
        });
        this.on('ready', () => {
            this.__status = 'ready';
        });
    }
    init() {
        throw new Error('Not implemented');
    }
    get serviceReady() {
        if (this.__status === 'revoked') {
            this.__status = 'pending';
            this.__serviceReady = new Promise((_resolve, _reject) => {
                this.once('ready', () => _resolve(this));
                this.once('error', _reject);
                this.dependencyReady.catch((err) => this.emit('error', err));
            });
            nextTickFunc(() => {
                try {
                    const r = this.init();
                    if (r && (typeof r.catch === 'function')) {
                        r.catch((err) => {
                            this.emit('error', err);
                        });
                    }
                }
                catch (err) {
                    this.emit('error', err);
                }
            });
        }
        return this.__serviceReady;
    }
    get dependencyReady() {
        return new Promise((_resolve, _reject) => {
            setTimeout(() => {
                _reject(new defer_1.TimeoutError('Timeout waiting for dependencies to be ready.'));
            }, 5000);
            _resolve(Promise.all(this.__dependencies.map((x) => x.serviceReady)).then((r) => {
                for (const x of r) {
                    if (x.__status !== 'ready') {
                        return this.dependencyReady;
                    }
                }
                return r;
            }));
        });
    }
}
exports.AsyncService = AsyncService;
//# sourceMappingURL=async-service.js.map