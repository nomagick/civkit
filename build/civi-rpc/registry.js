"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeRPCKit = exports.AbstractRPCRegistry = exports.PICK_RPC_PARAM_DECORATION_META_KEY = void 0;
const base_1 = require("./base");
const async_service_1 = require("../lib/async-service");
const errors_1 = require("./errors");
exports.PICK_RPC_PARAM_DECORATION_META_KEY = 'PickPram';
const ITSELF = Symbol('itself');
class AbstractRPCRegistry extends async_service_1.AsyncService {
    constructor() {
        super();
        this.__tick = 0;
        this.conf = new Map();
        this.wrapped = new Map();
        this.__tick = 1;
        this.init();
    }
    init() {
        setImmediate(() => {
            this.__tick++;
            this.dump();
            this.emit('ready');
        });
    }
    register(options) {
        const name = Array.isArray(options.name) ? options.name.join('.') : options.name;
        if (!name) {
            throw new Error('RPC name is required');
        }
        if (this.conf.has(name)) {
            throw new Error(`Duplicated RPC: ${name}`);
        }
        if (!options.method && !(options.hostProto && options.nameOnProto)) {
            throw new Error(`Unable to resolve RPC ${options.name}: could not find api function.`);
        }
        const resolvedFunc = options.method || options.hostProto[options.nameOnProto];
        if (typeof resolvedFunc !== 'function') {
            throw new Error(`Unable to resolve RPC ${options.name}: found non-function entity, function required.`);
        }
        this.conf.set(name, options);
        if (this.__tick === 1) {
            setImmediate(() => {
                this.wrapRPCMethod(name);
            });
            return;
        }
        return this.wrapRPCMethod(name);
    }
    wrapRPCMethod(name) {
        const conf = this.conf.get(name);
        if (!conf) {
            throw new Error(`Unknown method: ${name}`);
        }
        if (this.wrapped.has(name)) {
            return this.wrapped.get(name);
        }
        const func = conf.method || conf.hostProto[conf.nameOnProto];
        const paramTypes = conf?.paramTypes || [];
        const paramPickerMeta = Reflect.getMetadata(exports.PICK_RPC_PARAM_DECORATION_META_KEY, conf.hostProto);
        const paramPickerConf = paramPickerMeta ? paramPickerMeta[conf.nameOnProto] : undefined;
        const host = this.container.resolve(conf.hostProto.constructor);
        function patchedRPCMethod(input) {
            const params = paramTypes.map((t, i) => {
                const propOps = paramPickerConf?.[i];
                if (!propOps) {
                    return base_1.inputSingle(undefined, { [ITSELF]: input }, ITSELF, { path: ITSELF, type: t });
                }
                return base_1.inputSingle(undefined, input, propOps.path, { type: t, ...propOps });
            });
            return func.apply(host, params);
        }
        this.wrapped.set(name, patchedRPCMethod);
        return patchedRPCMethod;
    }
    dump() {
        return Array.from(this.conf.keys()).map((x) => {
            return [x.split('.'), this.wrapRPCMethod(x), this.conf.get(x)];
        });
    }
    exec(name, input) {
        const conf = this.conf.get(name);
        const func = this.wrapped.get(name);
        if (!(conf && func)) {
            throw new errors_1.RPCMethodNotFoundError({ message: `Could not found method of name: ${name}.`, method: name });
        }
        return func.call(conf.host, input);
    }
    decorators() {
        const RPCMethod = (options = {}) => {
            const _options = typeof options === 'string' ? { name: options } : options;
            const RPCDecorator = (tgt, methodName) => {
                const finalOps = {
                    ..._options,
                    name: _options.name || methodName,
                    paramTypes: _options.paramTypes || Reflect.getMetadata('design:paramtypes', tgt, methodName),
                    hostProto: tgt,
                    nameOnProto: methodName
                };
                this.register(finalOps);
            };
            return RPCDecorator;
        };
        const Pick = (path, conf) => {
            if ((typeof path === 'string' || typeof path === 'symbol')) {
                if (conf) {
                    conf.path = path;
                }
                else {
                    conf = { path: path };
                }
            }
            else if (typeof path === 'object') {
                conf = path;
            }
            const PickCtxParamDecorator = (tgt, methodName, paramIdx) => {
                let paramConf = Reflect.getMetadata(exports.PICK_RPC_PARAM_DECORATION_META_KEY, tgt);
                if (!paramConf) {
                    paramConf = {};
                    Reflect.defineMetadata(exports.PICK_RPC_PARAM_DECORATION_META_KEY, paramConf, tgt);
                }
                let methodConf = paramConf[methodName];
                if (!methodConf) {
                    methodConf = [];
                    paramConf[methodName] = methodConf;
                }
                methodConf[paramIdx] = conf;
            };
            return PickCtxParamDecorator;
        };
        return { RPCMethod, Pick };
    }
}
exports.AbstractRPCRegistry = AbstractRPCRegistry;
function makeRPCKit(container) {
    class RPCRegistry extends AbstractRPCRegistry {
        constructor() {
            super(...arguments);
            this.container = container;
        }
    }
    return RPCRegistry;
}
exports.makeRPCKit = makeRPCKit;
//# sourceMappingURL=registry.js.map