import { EventEmitter } from 'events';

export const SUBEMITTER_SYMBOL = Symbol('SubEmitter');

export interface WithSubEventEmitter extends EventEmitter {
    [SUBEMITTER_SYMBOL]?: EventEmitter;
}

export function subEmitter(hostEmitter: WithSubEventEmitter) {

    if (hostEmitter[SUBEMITTER_SYMBOL]) {
        return hostEmitter[SUBEMITTER_SYMBOL];
    }

    const subEmitter = new EventEmitter();

    // Vital here, not adding error emitter causes .emit function to throw up, which is unwanted behavior.
    subEmitter.on('error', () => 'no big deal');

    hostEmitter[SUBEMITTER_SYMBOL] = subEmitter;

    const origEmit = hostEmitter.emit;
    hostEmitter.emit = function (name: string, ...argv: any[]) {
        const r = origEmit.call(this, name, ...argv);
        const _subEmitter = this[SUBEMITTER_SYMBOL];
        if (_subEmitter) {
            _subEmitter.emit(name, ...argv);
        }

        return r;
    };

    return subEmitter;
}
