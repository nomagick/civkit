import 'reflect-metadata';
import { isConstructor, chainEntries } from '../utils/lang';

import _ from 'lodash';

export const AUTOCASTABLE_OPTIONS_SYMBOL = Symbol('AutoCastable options');

export const NOT_RESOLVED = Symbol('Not-Resolved');

export class AutoCastable {
    [AUTOCASTABLE_OPTIONS_SYMBOL]: { [k: string]: PropOptions<any> };

    static from<T extends AutoCastable = AutoCastable>(input: any): T {
        const instance = new this() as T;

        for (const [prop, config] of chainEntries(this.prototype[AUTOCASTABLE_OPTIONS_SYMBOL] || {})) {
            (instance as any)[prop] = inputSingle(this, input, prop, config);
        }

        return instance;
    }
}
export class AutoCastingError extends Error {
    path: string;
    desc?: string;
    value: any;
    types: string[];
    error?: Error;
    hostName?: string;
    propName: string;
    reason: string;

    constructor(detail: { [k: string]: any }) {
        super('AutocastingError');

        this.path = detail.path;
        this.reason = detail.reason;
        this.value = detail.value;
        this.types = detail.types;
        this.error = detail.error;
        this.desc = detail.desc;
        this.hostName = detail.hostName;
        this.propName = detail.propName;

        this.message = makeAutoCastingErrorMessage(this);
    }
}

function makeAutoCastingErrorMessage(err: AutoCastingError) {
    return `Casting failed for ${err.hostName || 'input'}.${err.propName}: ${err.path
        } ${err.reason[0]?.toLowerCase()}${err.reason.substring(1)}`;
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

    theLoop:
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
        } else if (typeShouldbe instanceof Set) {
            // Enums would end up here
            if (!typeShouldbe.has(inputProp)) {
                continue;
            }

            val = inputProp;
            break;
        }

        // Primitive types like Number, String, etc...
        theSwitch:
        switch (typeShouldbe) {
            case String: {
                val = String(inputProp);
                break theLoop;
            }

            case Number: {
                val = Number(inputProp);
                if (isNaN(val)) {
                    continue theLoop;
                }
                break theLoop;
            }

            case Boolean: {
                val = Boolean(inputProp);
                break theLoop;
            }

            // Object/Array is the type of all mixed/any/T[] types.
            case Array: {
                if (Array.isArray(inputProp)) {
                    val = inputProp;
                } else {
                    val = [inputProp];
                }

                break theLoop;
            }
            case Object: {
                val = inputProp;

                break theLoop;
            }

            case Date: {
                const tmpDate = new Date(inputProp);
                if (isNaN(tmpDate.valueOf())) {
                    const intVal = parseInt(inputProp, 10);

                    if (intVal >= Math.pow(10, 10)) {
                        val = new Date(intVal);

                        break theLoop;
                    } else if (intVal < Math.pow(10, 10)) {
                        val = new Date(intVal * 1000);

                        break theLoop;
                    }

                    continue theLoop;
                }
                val = tmpDate;

                break;
            }

            case Buffer: {
                val = Buffer.from(inputProp);

                break theLoop;
            }

            case null: {
                val = null;

                break theLoop;
            }

            case undefined: {
                val = undefined;

                break theLoop;
            }

            default: {
                if (inputProp instanceof typeShouldbe) {
                    val = inputProp;

                    break theLoop;
                }
                break theSwitch;
            }
        }

        if (isConstructor(typeShouldbe)) {
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
    const hostName = host?.name;
    const propName = prop.toString();

    if (config.arrayOf) {
        isArray = true;
        types = Array.isArray(config.arrayOf) ? config.arrayOf : [config.arrayOf];
    } else if (config.type) {
        types = Array.isArray(config.type) ? config.type : [config.type];
    } else {
        throw new Error(`Type info not provided: ${access.toString()}`);
    }

    const typeNames = types.map((t: any) => (t.name ? t.name : t).toString());

    const inputProp = _.get(input, access);

    if (inputProp === undefined) {
        if (config.default !== undefined) {
            return config.default;
        }
        if (config.required) {
            throw new AutoCastingError({
                reason: `Required but not provided.`,
                path: access.toString(),
                hostName,
                propName,
                value: inputProp,
                desc: config.desc,
            });
        }
    }

    if (isArray) {
        if (inputProp === undefined) {
            return undefined;
        }

        if (inputProp === null) {
            return [];
        }

        const arrayInput = Array.isArray(inputProp) ? inputProp : [inputProp];

        const values: any[] = [];

        for (const [i, x] of arrayInput.entries()) {
            let elem: any = NOT_RESOLVED;
            try {
                elem = castToType(types, x);
            } catch (err: any) {
                if (err.propName) {
                    err.hostName = hostName;
                    err.propName = `${propName}[${i}].${err.propName}`;
                    err.path = `${access.toString()}[${i}].${err.path}`;
                    err.message = makeAutoCastingErrorMessage(err);

                    throw err;
                }

                throw new AutoCastingError({
                    reason: `Not within type [${typeNames.join('|')}].`,
                    path: `${access.toString()}[${i}]`,
                    hostName,
                    propName: `${propName}[${i}]`,
                    value: x,
                    types: typeNames,
                    error: err.toString(),
                    desc: config.desc,
                });
            }

            if (elem === NOT_RESOLVED) {
                throw new AutoCastingError({
                    reason: `Not within type [${typeNames.join('|')}].`,
                    path: `${access.toString()}[${i}]`,
                    hostName,
                    propName: `${propName}[${i}]`,
                    value: x,
                    types: typeNames,
                    desc: config.desc,
                });
            }

            if (config.validate) {
                const validators = Array.isArray(config.validate) ? config.validate : [config.validate];

                for (const validator of validators) {
                    let result;
                    try {
                        result = validator(elem, input);
                    } catch (err: any) {
                        throw new AutoCastingError({
                            reason: `Validator ${config.validate.name} has thrown an error: ${err.toString()}.`,
                            path: `${access.toString()}`,
                            hostName,
                            propName: `${propName}[${i}]`,
                            value: inputProp,
                            validator: config.validate.name,
                            desc: config.desc,
                            error: err,
                        });
                    }

                    if (!result) {
                        throw new AutoCastingError({
                            reason: `Rejected by validator ${config.validate.name}.`,
                            path: `${access.toString()}`,
                            hostName,
                            propName: `${propName}[${i}]`,
                            value: inputProp,
                            validator: config.validate.name,
                            desc: config.desc,
                        });
                    }
                }
            }

            if (elem === undefined) {
                continue;
            }

            values.push(elem);
        }

        if (config.validateArray) {
            const validators = Array.isArray(config.validateArray) ? config.validateArray : [config.validateArray];

            for (const validator of validators) {
                const result = validator(values, arrayInput);

                if (!result) {
                    throw new AutoCastingError({
                        reason: `Rejected by array validator ${config.validateArray.name}.`,
                        path: `${access.toString()}`,
                        hostName,
                        propName,
                        value: arrayInput,
                        validator: config.validateArray.name,
                        desc: config.desc,
                    });
                }
            }
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
        if (err.propName) {
            err.hostName = hostName;
            err.propName = `${propName}.${err.propName}`;
            err.path = `${access.toString()}.${err.path}`;
            err.message = makeAutoCastingErrorMessage(err);

            throw err;
        }
        if (inputProp !== undefined) {
            throw new AutoCastingError({
                reason: `Not within type [${typeNames.join('|')}].`,
                path: `${access.toString()}`,
                hostName,
                propName,
                value: inputProp,
                types: typeNames,
                error: err.toString(),
                desc: config.desc,
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
                reason: `Not within type [${typeNames.join('|')}].`,
                path: `${access.toString()}`,
                hostName,
                propName,
                value: inputProp,
                types: typeNames,
                desc: config.desc,
            });
        }

        return undefined;
    }

    if (config.validate) {
        const validators = Array.isArray(config.validate) ? config.validate : [config.validate];

        for (const validator of validators) {
            let result;
            try {
                result = validator(item, input);
            } catch (err: any) {
                throw new AutoCastingError({
                    reason: `Validator ${config.validate.name} has thrown an error: ${err.toString()}.`,
                    path: `${access.toString()}`,
                    hostName,
                    propName,
                    value: inputProp,
                    validator: config.validate.name,
                    desc: config.desc,
                    error: err,
                });
            }

            if (!result) {
                throw new AutoCastingError({
                    reason: `Rejected by validator ${config.validate.name}.`,
                    path: `${access.toString()}`,
                    hostName,
                    propName,
                    value: inputProp,
                    validator: config.validate.name,
                    desc: config.desc,
                });
            }
        }
    }

    return item;
}

export type Enum = Set<number | string> | { [k: string]: number | string;[w: number]: number | string };

export interface PropOptions<T> {
    path?: string | symbol;
    type?: any | any[];
    arrayOf?: any | any[];
    validate?: (val: T, obj?: any) => boolean | Array<(val: T, obj?: any) => boolean>;
    validateArray?: (val: T, obj?: any) => boolean | Array<(val: T, obj?: any) => boolean>;
    required?: boolean;
    default?: T;
    desc?: string;
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

    result.toString = function () {
        return `ENUM(${Array.from(this.values()).join('|')})`;
    };

    return result;
}

function enumToString(this: Set<any>) {
    const str = Array.from(this.values()).join('|');

    return `ENUM(${str.length > 128 ? str.substring(0, 128) + '...' : str})`;
}

export function __patchPropOptionsEnumToSet<T = any>(options: PropOptions<T>, designType: any) {
    if (Array.isArray(options.type)) {
        options.type = options.type.map((x) => {
            if (_.isPlainObject(x)) {
                return enumToSet(x);
            } else if (x instanceof Set) {
                x.toString = enumToString;
            }

            return x;
        });
    }

    if (Array.isArray(options.arrayOf)) {
        options.arrayOf = options.arrayOf.map((x) => {
            if (_.isPlainObject(x)) {
                return enumToSet(x);
            } else if (x instanceof Set) {
                x.toString = enumToString;
            }

            return x;
        });
    }

    if (_.isPlainObject(options.type)) {
        // Its enum.
        options.type = enumToSet(options.type, designType);
    } else if (options.type instanceof Set) {
        options.type.toString = enumToString;
    }

    if (_.isPlainObject(options.arrayOf)) {
        // Its enum.
        options.arrayOf = enumToSet(options.arrayOf, designType);
    } else if (options.arrayOf instanceof Set) {
        options.arrayOf.toString = enumToString;
    }

    return options;
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

        // design:type come from TypeScript compile time decorator-metadata.
        const designType = Reflect.getMetadata('design:type', tgt, propName);

        if (!_options.type && !_options.arrayOf) {
            _options.type = designType;
        }

        hostConfig[propName] = __patchPropOptionsEnumToSet(_options, designType);
    };
}
