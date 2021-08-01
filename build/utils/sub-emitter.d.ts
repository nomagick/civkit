/// <reference types="node" />
import { EventEmitter } from 'events';
export declare const SUBEMITTER_SYMBOL: unique symbol;
export interface WithSubEventEmitter extends EventEmitter {
    [SUBEMITTER_SYMBOL]?: EventEmitter;
}
export declare function subEmitter(hostEmitter: WithSubEventEmitter): EventEmitter | undefined;
//# sourceMappingURL=sub-emitter.d.ts.map