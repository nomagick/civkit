"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GCProofDefer = exports.TimedDefer = exports.TimeoutError = exports.Defer = void 0;
function Defer() {
    const self = {};
    self.promise = new Promise((resolve, reject) => {
        self.resolve = resolve;
        self.reject = reject;
    });
    Object.freeze(self);
    return self;
}
exports.Defer = Defer;
class TimeoutError extends Error {
    constructor() {
        super(...arguments);
        this.code = 'ETIMEDOUT';
    }
}
exports.TimeoutError = TimeoutError;
function TimedDefer(timeout = 5000) {
    const self = {};
    self.promise = new Promise((resolve, reject) => {
        let timeoutHandle = setTimeout(() => {
            self.reject(new TimeoutError(`Timed out after ${timeout}ms.`));
        }, timeout);
        self.resolve = (stuff) => {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
                timeoutHandle = null;
            }
            return resolve(stuff);
        };
        self.reject = (...argv) => {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
                timeoutHandle = null;
            }
            return reject(...argv);
        };
    });
    Object.freeze(self);
    return self;
}
exports.TimedDefer = TimedDefer;
function GCProofDefer() {
    let resolve;
    let reject;
    const thePromise = new Promise((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;
    });
    thePromise.__resolve = resolve;
    thePromise.__reject = reject;
    return thePromise;
}
exports.GCProofDefer = GCProofDefer;
//# sourceMappingURL=defer.js.map