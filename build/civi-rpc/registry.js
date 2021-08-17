"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeRPCKit = exports.AbstractRPCRegistry = exports.PICK_RPC_PARAM_DECORATION_META_KEY = void 0;
const tslib_1 = require("tslib");
const lodash_1 = tslib_1.__importDefault(require("lodash"));
const base_1 = require("./base");
const async_service_1 = require("../lib/async-service");
const errors_1 = require("./errors");
exports.PICK_RPC_PARAM_DECORATION_META_KEY = 'PickPram';
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
        function patchedRPCMethod(ctx) {
            const params = paramTypes.map((t, i) => {
                const access = paramPickerConf?.[i];
                if (!access && (t.prototype instanceof base_1.RPCParam)) {
                    return t.fromObject(ctx);
                }
                let input;
                if (typeof access === 'string' || typeof access === 'symbol') {
                    input = lodash_1.default.get(ctx, access);
                }
                else if (typeof access === 'function') {
                    input = access.call(this, ctx);
                }
                else {
                    input = ctx;
                }
                if (access === undefined) {
                    return input;
                }
                if (input === undefined) {
                    return input;
                }
                let output;
                try {
                    output = base_1.castToType([t], input);
                }
                catch (err) {
                    throw new errors_1.ParamValidationError({
                        message: `Validation failed for param[${i}] of method ${name}: input[${access}] not of type [${t.name}].`,
                        path: access, value: input, type: t.name, err
                    });
                }
                if (output === base_1.NOT_RESOLVED) {
                    throw new errors_1.ParamValidationError({
                        message: `Validation failed for param[${i}] of method ${name}: input[${access}] not of type [${t.name}].`,
                        path: access, value: input, type: t.name
                    });
                }
                return output;
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
        const Pick = (path) => {
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
                methodConf[paramIdx] = path || true;
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