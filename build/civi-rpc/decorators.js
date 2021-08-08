"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Prop = void 0;
const tslib_1 = require("tslib");
const lodash_1 = tslib_1.__importDefault(require("lodash"));
const base_1 = require("./base");
function enumToSet(enumObj, designType) {
    const result = new Set();
    if (designType === String) {
        for (const x of Object.values(enumObj)) {
            if (typeof x === 'string') {
                result.add(x);
            }
        }
    }
    else if (designType === Number) {
        for (const x of Object.values(enumObj)) {
            if (typeof x === 'number') {
                result.add(x);
            }
        }
    }
    else {
        for (const x of Object.values(enumObj)) {
            result.add(x);
        }
    }
    result.toString = function () {
        return `ENUM(${Array.from(this.values()).join('|')})`;
    };
    return result;
}
function Prop(options = {}) {
    const _options = typeof options === 'string' ? { path: options } : options;
    return function RPCParamPropDecorator(tgt, propName) {
        if (!tgt[base_1.RPCPARAM_OPTIONS_SYMBOL]) {
            tgt[base_1.RPCPARAM_OPTIONS_SYMBOL] = {};
        }
        else if (!tgt.hasOwnProperty(base_1.RPCPARAM_OPTIONS_SYMBOL)) {
            tgt[base_1.RPCPARAM_OPTIONS_SYMBOL] = Object.create(tgt[base_1.RPCPARAM_OPTIONS_SYMBOL]);
        }
        const hostConfig = tgt[base_1.RPCPARAM_OPTIONS_SYMBOL];
        _options.path = _options.path || propName;
        if (!_options.type && !_options.arrayOf) {
            _options.type = Reflect.getMetadata('design:type', tgt, propName);
        }
        if (Array.isArray(_options.type)) {
            _options.type = _options.type.map((x) => {
                if (lodash_1.default.isPlainObject(x)) {
                    return enumToSet(x);
                }
                else if (x instanceof Set) {
                    x.toString = function () {
                        return `ENUM(${Array.from(this.values()).join('|')})`;
                    };
                }
                return x;
            });
        }
        if (Array.isArray(_options.arrayOf)) {
            _options.arrayOf = _options.arrayOf.map((x) => {
                if (lodash_1.default.isPlainObject(x)) {
                    return enumToSet(x);
                }
                else if (x instanceof Set) {
                    x.toString = function () {
                        return `ENUM(${Array.from(this.values()).join('|')})`;
                    };
                }
                return x;
            });
        }
        if (lodash_1.default.isPlainObject(_options.type)) {
            const designType = Reflect.getMetadata('design:type', tgt, propName);
            _options.type = enumToSet(_options.type, designType);
        }
        else if (_options.type instanceof Set) {
            _options.type.toString = function () {
                return `ENUM(${Array.from(this.values()).join('|')})`;
            };
        }
        if (lodash_1.default.isPlainObject(_options.arrayOf)) {
            const designType = Reflect.getMetadata('design:type', tgt, propName);
            _options.arrayOf = enumToSet(_options.arrayOf, designType);
        }
        else if (_options.arrayOf instanceof Set) {
            _options.arrayOf.toString = function () {
                return `ENUM(${Array.from(this.values()).join('|')})`;
            };
        }
        hostConfig[propName] = _options;
    };
}
exports.Prop = Prop;
//# sourceMappingURL=decorators.js.map