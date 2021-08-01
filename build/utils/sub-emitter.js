"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subEmitter = exports.SUBEMITTER_SYMBOL = void 0;
const events_1 = require("events");
exports.SUBEMITTER_SYMBOL = Symbol('SubEmitter');
function subEmitter(hostEmitter) {
    if (hostEmitter[exports.SUBEMITTER_SYMBOL]) {
        return hostEmitter[exports.SUBEMITTER_SYMBOL];
    }
    const subEmitter = new events_1.EventEmitter();
    subEmitter.on('error', () => 'no big deal');
    hostEmitter[exports.SUBEMITTER_SYMBOL] = subEmitter;
    const origEmit = hostEmitter.emit;
    hostEmitter.emit = function (name, ...argv) {
        const r = origEmit.call(this, name, ...argv);
        const _subEmitter = this[exports.SUBEMITTER_SYMBOL];
        if (_subEmitter) {
            _subEmitter.emit(name, ...argv);
        }
        return r;
    };
    return subEmitter;
}
exports.subEmitter = subEmitter;
//# sourceMappingURL=sub-emitter.js.map