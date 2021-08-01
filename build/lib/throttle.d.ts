/// <reference types="node" />
import { EventEmitter } from 'events';
import { Deferred } from './defer';
export declare class PromiseThrottle extends EventEmitter {
    serial: number;
    finished: number;
    throttle: number;
    occupancy: number;
    deferreds: Array<Deferred<this>>;
    private _nextTickRoutine;
    private _wasIdle;
    constructor(throttle?: number);
    routine(): void;
    acquire(): Promise<this>;
    release(): void;
    nextDrain(): Promise<unknown>;
}
//# sourceMappingURL=throttle.d.ts.map