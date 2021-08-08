import _ from "lodash";
import { PropOptions, RPCParam, RPCPARAM_OPTIONS_SYMBOL } from "./base";

function enumToSet(enumObj: any, designType?: any) {
    const result = new Set<string | number>();
    if (designType === String) {
        for (const x of Object.values(enumObj as any)) {
            if (typeof x === 'string') {
                result.add(x);
            }
        }
    } else if (designType === Number) {
        for (const x of Object.values(enumObj as any)) {
            if (typeof x === 'number') {
                result.add(x);
            }
        }
    } else {
        for (const x of Object.values(enumObj as any)) {
            result.add(x as any);
        }
    }
    // tslint:disable-next-line: only-arrow-functions
    result.toString = function () {
        return `ENUM(${Array.from(this.values()).join('|')})`;
    };

    return result;
}

export function Prop<T = any>(options: PropOptions<T> | string = {}) {
    const _options = typeof options === 'string' ? { path: options } : options;

    return function RPCParamPropDecorator(tgt: typeof RPCParam.prototype, propName: string) {
        if (!tgt[RPCPARAM_OPTIONS_SYMBOL]) {
            tgt[RPCPARAM_OPTIONS_SYMBOL] = {};
        } else if (!tgt.hasOwnProperty(RPCPARAM_OPTIONS_SYMBOL)) {
            tgt[RPCPARAM_OPTIONS_SYMBOL] = Object.create(tgt[RPCPARAM_OPTIONS_SYMBOL]);
        }

        const hostConfig = tgt[RPCPARAM_OPTIONS_SYMBOL];

        _options.path = _options.path || propName;

        if (!_options.type && !_options.arrayOf) {
            // design:type come from TypeScript compile time decorator-metadata.
            _options.type = Reflect.getMetadata('design:type', tgt, propName);
        }

        if (Array.isArray(_options.type)) {
            _options.type = _options.type.map((x) => {
                if (_.isPlainObject(x)) {
                    return enumToSet(x);
                } else if (x instanceof Set) {
                    x.toString = function () {
                        return `ENUM(${Array.from(this.values()).join('|')})`;
                    };
                }

                return x;
            });
        }

        if (Array.isArray(_options.arrayOf)) {
            _options.arrayOf = _options.arrayOf.map((x) => {
                if (_.isPlainObject(x)) {
                    return enumToSet(x);
                } else if (x instanceof Set) {
                    x.toString = function () {
                        return `ENUM(${Array.from(this.values()).join('|')})`;
                    };
                }

                return x;
            });
        }

        if (_.isPlainObject(_options.type)) {
            // Its enum.
            const designType = Reflect.getMetadata('design:type', tgt, propName);
            _options.type = enumToSet(_options.type, designType);
        } else if (_options.type instanceof Set) {
            _options.type.toString = function () {
                return `ENUM(${Array.from(this.values()).join('|')})`;
            };
        }

        if (_.isPlainObject(_options.arrayOf)) {
            // Its enum.
            const designType = Reflect.getMetadata('design:type', tgt, propName);
            _options.arrayOf = enumToSet(_options.arrayOf, designType);
        } else if (_options.arrayOf instanceof Set) {
            _options.arrayOf.toString = function () {
                return `ENUM(${Array.from(this.values()).join('|')})`;
            };
        }

        hostConfig[propName] = _options;
    };
}
