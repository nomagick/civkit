"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromiseThrottle = void 0;
const events_1 = require("events");
const defer_1 = require("./defer");
const nextTickFunc = process?.nextTick || setImmediate || setTimeout;
class PromiseThrottle extends events_1.EventEmitter {
    constructor(throttle = 3) {
        super();
        this.serial = 0;
        this.finished = 0;
        this.throttle = 1;
        this.occupancy = 0;
        this.deferreds = [];
        this._nextTickRoutine = false;
        this._wasIdle = true;
        this.throttle = parseInt(Math.floor(throttle).toString(), 10);
    }
    routine() {
        this._nextTickRoutine = false;
        const leftovers = (this.serial - this.finished) - this.throttle;
        while (this.deferreds.length && (this.deferreds.length > leftovers)) {
            const handle = this.deferreds.shift();
            if (handle) {
                handle.resolve(this);
                this.occupancy += 1;
            }
        }
        if (this.occupancy === 0) {
            if (!this._wasIdle) {
                this.emit('drain');
            }
            this._wasIdle = true;
        }
        else {
            this._wasIdle = false;
        }
    }
    acquire() {
        this.serial += 1;
        const theDeferred = defer_1.Defer();
        this.deferreds.push(theDeferred);
        if (!this._nextTickRoutine) {
            this._nextTickRoutine = true;
            nextTickFunc(() => {
                this.routine();
            });
        }
        return theDeferred.promise;
    }
    release() {
        this.finished += 1;
        this.occupancy -= 1;
        this.routine();
    }
    nextDrain() {
        if (!this._nextTickRoutine && this.occupancy === 0) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.once('drain', resolve);
        });
    }
}
exports.PromiseThrottle = PromiseThrottle;
//# sourceMappingURL=throttle.js.map