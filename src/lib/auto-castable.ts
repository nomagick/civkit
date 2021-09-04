import 'reflect-metadata';
import { isConstructor, chainEntries } from '../utils/lang';

import _ from 'lodash';

export const AUTOCASTABLE_OPTIONS_SYMBOL = Symbol('AutoCastable options');

export const NOT_RESOLVED = Symbol('Not-Resolved');

export class AutoCastable {
    [AUTOCASTABLE_OPTIONS_SYMBOL]: { [k: string]: PropOptions<any> };

    static from(input: any) {
        const instance = new this();

        for (const [prop, config] of chainEntries(this.prototype[AUTOCASTABLE_OPTIONS_SYMBOL] || {})) {

            (instance as any)[prop] = inputSingle(this, input, prop, config);

        }

        return instance;
    }

}

const nativeTypes = new Set<new (p: any) => any>([
    RegExp
]);

export class AutoCastingError extends Error {
    path: string;
    value: any;
    types: string[];
    error?: Error;

    constructor(detail: { [k: string]: any }) {
        super(detail.message);

        this.path = detail.path;
        this.value = detail.value;
        this.types = detail.types;
        this.error = detail.error;
    }
}


export function castToType(ensureTypes: any[], inputProp: any) {
    let val: any = NOT_RESOLVED;
    let lastErr: Error | undefined | unknown;
    if (inputProp === undefined) {
        if (ensureTypes.includes(undefined)) {
            return undefined;
        }

        return NOT_RESOLVED;
    }

    for (const typeShouldbe of ensureTypes) {
        // AutoCastable types
        if (typeShouldbe.prototype instanceof AutoCastable) {

            try {
                val = (typeShouldbe as typeof AutoCastable).from(inputProp);
            } catch (err) {
                lastErr = err;
                continue;
            }

            if (val instanceof typeShouldbe) {
                break;
            }
            continue;
        }

        // Native types like Date, RegExp, etc..
        if (nativeTypes.has(typeShouldbe)) {
            try {
                val = new typeShouldbe(inputProp);
            } catch (err) {
                lastErr = err;
                continue;
            }

            if (val instanceof typeShouldbe) {
                break;
            }
            continue;
        }

        // Primitive types like Number, String, etc...
        switch (typeShouldbe) {

            case Buffer: {
                val = Buffer.from(inputProp);
                break;
            }

            case Number: {
                val = Number(inputProp);
                if (isNaN(val)) {
                    continue;
                }
                break;
            }

            case String: {
                val = String(inputProp);
                break;
            }

            case Boolean: {
                val = Boolean(inputProp);
                break;
            }

            case Date: {
                const tmpDate = new Date(inputProp);
                if (isNaN(tmpDate.valueOf())) {

                    const intVal = parseInt(inputProp, 10);

                    if (intVal >= Math.pow(10, 10)) {
                        val = new Date(intVal);

                        break;
                    } else if (intVal < Math.pow(10, 10)) {
                        val = new Date(intVal * 1000);

                        break;
                    }

                    continue;
                }
                val = tmpDate;

                break;
            }

            case null: {
                val = null;

                break;
            }

            case undefined: {
                val = undefined;

                break;
            }

            // Object/Array is the type of all mixed/any/T[] types.
            case Array:
            case Object: {
                val = inputProp;

                break;
            }
            default: {
                if ((typeof typeShouldbe === 'function') && (inputProp instanceof typeShouldbe)) {
                    val = inputProp;
                } else if (isConstructor(typeShouldbe)) {
                    try {
                        val = new typeShouldbe(inputProp);
                    } catch (err) {
                        lastErr = err;
                        continue;
                    }
                } else if (typeof typeShouldbe === 'function') {
                    try {
                        val = typeShouldbe(inputProp);
                    } catch (err) {
                        lastErr = err;
                        continue;
                    }
                } else if (typeShouldbe instanceof Set) {
                    // Enums would end up here
                    if (!typeShouldbe.has(inputProp)) {
                        continue;
                    }

                    val = inputProp;
                }
            }
        }

        if (val !== NOT_RESOLVED) {
            break;
        }
    }

    if (val === NOT_RESOLVED && lastErr) {
        throw lastErr;
    }

    return val;
}

export function inputSingle<T>(host: Function | undefined, input: any, prop: string | symbol, config: PropOptions<T>) {
    let types: any;
    let isArray = false;
    const access = config.path || prop;
    const mappedPath = (host?.name && prop) ? `${host.name}.${prop.toString()}` : `input[${access.toString()}]`;

    if (config.arrayOf) {
        isArray = true;
        types = Array.isArray(config.arrayOf) ? config.arrayOf : [config.arrayOf];
    } else if (config.type) {
        types = Array.isArray(config.type) ? config.type : [config.type];
    } else {
        throw new Error(`Type info not provided: ${access.toString()}`);
    }

    const inputProp = _.get(input, access);

    if (inputProp === undefined && config.default !== undefined) {
        return config.default;
    }

    if (inputProp === undefined && config.required) {
        throw new AutoCastingError({
            message: `Casting failed for ${mappedPath}: ${access.toString()} is required but not provided.`,
            path: config.path, value: inputProp
        });
    }

    if (isArray) {
        if (inputProp === null) {
            return [];
        }
        if (inputProp === undefined) {
            return undefined;
        }

        const arrayInput = Array.isArray(inputProp) ? inputProp : [inputProp];

        const values: any[] = [];

        for (const [i, x] of arrayInput.entries()) {
            let elem: any = NOT_RESOLVED;
            try {
                elem = castToType(types, x);

            } catch (err: any) {
                const typeNames = types.map((t: any) => (t.name ? t.name : t).toString());
                throw new AutoCastingError({
                    message: `Casting failed for ${mappedPath}: ${access.toString()}[${i}] not within type [${typeNames.join('|')}].`,
                    path: `${access.toString()}[${i}]`, value: x, types: typeNames, error: err.toString()
                });
            }

            if (elem === NOT_RESOLVED) {
                const typeNames = types.map((t: any) => (t.name ? t.name : t).toString());
                throw new AutoCastingError({
                    message: `Casting failed for ${mappedPath}: ${access.toString()}[${i}] not within type [${typeNames.join('|')}].`,
                    path: `${access.toString()}[${i}]`, value: x, types: typeNames
                });
            }

            if (config.validate) {
                const validators = Array.isArray(config.validate) ? config.validate : [config.validate];

                for (const validator of validators) {

                    const result = validator(elem, input);

                    if (!result) {
                        throw new AutoCastingError({
                            message: `Casting failed for ${mappedPath}: ${access.toString()} rejected by validator ${config.validate.name}.`,
                            path: `${access.toString()}`, value: inputProp, validator: config.validate.name
                        });
                    }
                }
            }

            if (elem === undefined) {
                continue;
            }

            values.push(elem);
        }

        return values;
    }

    if (inputProp === null) {
        return null;
    }

    let item: any = NOT_RESOLVED;

    try {
        item = castToType(types, inputProp);
    } catch (err: any) {
        if (inputProp !== undefined) {
            const typeNames = types.map((t: any) => (t.name ? t.name : t).toString());
            throw new AutoCastingError({
                message: `Casting failed for ${mappedPath}: ${access.toString()} not within type [${typeNames.join('|')}].`,
                path: `${access.toString()}`, value: inputProp, types: typeNames, error: err.toString()
            });
        }

    }

    if (item === NOT_RESOLVED || item === undefined) {

        if (config.default) {
            return config.default;
        }

        if (config.required || inputProp !== undefined) {
            const typeNames = types.map((t: any) => (t.name ? t.name : t).toString());
            throw new AutoCastingError({
                message: `Casting failed for ${mappedPath}: ${access.toString()} not within type [${typeNames.join('|')}].`,
                path: `${access.toString()}`, value: inputProp, types: typeNames
            });
        }

        return undefined;
    }

    if (config.validate) {

        const validators = Array.isArray(config.validate) ? config.validate : [config.validate];

        for (const validator of validators) {

            const result = validator(item, input);

            if (!result) {
                throw new AutoCastingError({
                    message: `Casting failed for ${mappedPath}: ${access.toString()} rejected by validator ${config.validate.name}.`,
                    path: `${access.toString()}`, value: inputProp, validator: config.validate.name
                });
            }
        }

    }

    return item;
}

export type Enum = Set<number | string> | { [k: string]: number | string, [w: number]: number | string };

export interface PropOptions<T> {
    path?: string | symbol;
    type?: any | any[];
    arrayOf?: any | any[];
    validate?: (val: T, obj?: any) => boolean | Array<(val: T, obj?: any) => boolean>;
    required?: boolean;
    default?: T;
}


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

    return function RPCParamPropDecorator(tgt: typeof AutoCastable.prototype, propName: string) {
        if (!tgt[AUTOCASTABLE_OPTIONS_SYMBOL]) {
            tgt[AUTOCASTABLE_OPTIONS_SYMBOL] = {};
        } else if (!tgt.hasOwnProperty(AUTOCASTABLE_OPTIONS_SYMBOL)) {
            tgt[AUTOCASTABLE_OPTIONS_SYMBOL] = Object.create(tgt[AUTOCASTABLE_OPTIONS_SYMBOL]);
        }

        const hostConfig = tgt[AUTOCASTABLE_OPTIONS_SYMBOL];

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
