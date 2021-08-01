import { EventEmitter } from 'events';
import { Defer, Deferred } from './defer';

const nextTickFunc = process?.nextTick || setImmediate || setTimeout;

export class PromiseThrottle extends EventEmitter {
    serial = 0;
    finished = 0;
    throttle = 1;
    occupancy = 0;
    deferreds: Array<Deferred<this>> = [];
    private _nextTickRoutine = false;
    private _wasIdle = true;
    constructor(throttle = 3) {
        super();
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
        } else {
            this._wasIdle = false;
        }
    }

    acquire() {
        this.serial += 1;
        const theDeferred = Defer<this>();
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
