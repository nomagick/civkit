import 'reflect-metadata';
import { isConstructor, chainEntries } from '../utils/lang';

import _ from 'lodash';

export const AUTOCASTABLE_OPTIONS_SYMBOL = Symbol('AutoCastable options');
export const AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL = Symbol('AutoCastable additional options');

export const NOT_RESOLVED = Symbol('Not-Resolved');

export type AdditionalPropOptions<T> = Pick<
    PropOptions<T>,
    | 'dictOf'
    | 'validate'
    | 'validateCollection'
    | 'desc'
    | 'ext'
>;

export class AutoCastable {
    protected [AUTOCASTABLE_OPTIONS_SYMBOL]?: { [k: string]: PropOptions<unknown>; };
    protected [AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]?: AdditionalPropOptions<this>;

    /**
     * Retrieve and verify an object based on the props (required, type, default and so on)
     */
    static from<T>(input: object): T {
        const instance = new this() as InstanceType<typeof this>;

        const entryVecs = chainEntries(this.prototype[AUTOCASTABLE_OPTIONS_SYMBOL] || {});
        for (const [prop, config] of entryVecs) {
            const val = inputSingle(this, input, prop, config);
            if (val === undefined) {
                continue;
            }
            (instance as any)[prop] = val;
        }

        if (this.prototype[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]) {
            const additionalConf = this.prototype[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL];

            if (additionalConf?.dictOf && _.isObjectLike(input)) {
                const namedEntryKeys = entryVecs.map(([k]) => k);
                const dict = inputSingle(this, _.omit(input, ...namedEntryKeys), undefined, additionalConf);

                Object.assign(instance, dict);
            }
        }

        return instance as any;
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

    constructor(detail: { [k: string]: any; }) {
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
    for (const typeShouldBe of ensureTypes) {
        // AutoCastable types
        if (typeShouldBe.prototype instanceof AutoCastable) {
            try {
                val = (typeShouldBe as typeof AutoCastable).from(inputProp);
            } catch (err) {
                lastErr = err;
                continue;
            }

            if (val instanceof typeShouldBe) {
                break;
            }
            continue;
        } else if (typeShouldBe instanceof Set) {
            // Enums would end up here
            if (!typeShouldBe.has(inputProp)) {
                continue;
            }

            val = inputProp;
            break;
        }

        // Primitive types like Number, String, etc...
        theSwitch:
        switch (typeShouldBe) {
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
                if (inputProp instanceof typeShouldBe) {
                    val = inputProp;

                    break theLoop;
                }
                break theSwitch;
            }
        }

        if (isConstructor(typeShouldBe)) {
            try {
                val = new typeShouldBe(inputProp);
            } catch (err) {
                lastErr = err;
                continue;
            }
        } else if (typeof typeShouldBe === 'function') {
            try {
                val = typeShouldBe(inputProp);
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

export function inputSingle<T>(
    host: Function | undefined, input: any, prop: string | symbol | undefined, config: PropOptions<T>
) {
    let types: any;
    let isArray = false;
    let isDict = false;
    const access = config.path || prop;
    const hostName = host?.name;
    const propName = prop?.toString() || '';
    const accessText = access ? access.toString() : '';

    const inputProp = access === undefined ? input : _.get(input, access);

    if (config.type) {
        types = Array.isArray(config.type) ? config.type : [config.type];
    } else if (config.arrayOf) {
        isArray = true;
        types = Array.isArray(config.arrayOf) ? config.arrayOf : [config.arrayOf];
    } else if (config.dictOf) {
        isDict = true;
        types = Array.isArray(config.dictOf) ? config.dictOf : [config.dictOf];
    } else {
        throw new Error(`Type info not provided${accessText ? `: ${accessText}` : host?.name}`);
    }

    const typeNames = types.map((t: any) => (t.name ? t.name : t).toString());


    if (inputProp === undefined) {
        if (config.default !== undefined) {
            return config.default;
        }
        if ((typeof config.defaultFactory) === 'function') {
            return config.defaultFactory!.call(host, input, access);
        }
        if (config.required) {
            throw new AutoCastingError({
                reason: `Required but not provided.`,
                path: accessText,
                hostName,
                propName,
                value: inputProp,
                desc: config.desc,
            });
        }

        return undefined;
    }

    if (inputProp === null) {
        return null;
    }

    if (isArray) {
        if (inputProp === undefined) {
            return undefined;
        }

        const arrayInput = Array.isArray(inputProp) ? inputProp : [inputProp];

        const values: T[] = [];

        for (const [i, x] of arrayInput.entries()) {
            let elem: any = NOT_RESOLVED;
            try {
                elem = castToType(types, x);
            } catch (err: any) {
                console.log(err);
                if (err.propName) {
                    err.hostName = hostName;
                    err.propName = `${propName}[${i}].${err.propName}`;
                    err.path = `${accessText}[${i}].${err.path}`;
                    err.message = makeAutoCastingErrorMessage(err);

                    throw err;
                }

                throw new AutoCastingError({
                    reason: `Not within type [${typeNames.join('|')}].`,
                    path: `${accessText}[${i}]`,
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
                    path: `${accessText}[${i}]`,
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
                            path: `${accessText}`,
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
                            path: `${accessText}`,
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

        if (config.validateCollection) {
            const validators = Array.isArray(config.validateCollection) ?
                config.validateCollection : [config.validateCollection];

            for (const validator of validators) {
                const result = validator(values, input);

                if (!result) {
                    throw new AutoCastingError({
                        reason: `Rejected by collection validator ${config.validateCollection.name}.`,
                        path: `${accessText}`,
                        hostName,
                        propName,
                        value: arrayInput,
                        validator: config.validateCollection.name,
                        desc: config.desc,
                    });
                }
            }
        }

        return values;
    }

    if (isDict) {
        if (inputProp === undefined) {
            return undefined;
        }

        const dictInput = inputProp;

        if (!_.isObjectLike(dictInput)) {
            return {};
        }

        const values: { [k: string]: T; } = {};

        for (const [k, v] of Object.entries(dictInput)) {
            let elem: any = NOT_RESOLVED;
            try {
                elem = castToType(types, v);
            } catch (err: any) {
                if (err.propName) {
                    err.hostName = hostName;
                    err.propName = `${propName}['${k}'].${err.propName}`;
                    err.path = `${accessText}['${k}'].${err.path}`;
                    err.message = makeAutoCastingErrorMessage(err);

                    throw err;
                }

                throw new AutoCastingError({
                    reason: `Not within type [${typeNames.join('|')}].`,
                    path: `${accessText}['${k}']`,
                    hostName,
                    propName: `${propName}['${k}']`,
                    value: v,
                    types: typeNames,
                    error: err.toString(),
                    desc: config.desc,
                });
            }

            if (elem === NOT_RESOLVED) {
                throw new AutoCastingError({
                    reason: `Not within type [${typeNames.join('|')}].`,
                    path: `${accessText}['${k}']`,
                    hostName,
                    propName: `${propName}['${k}']`,
                    value: v,
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
                            path: `${accessText}`,
                            hostName,
                            propName: `${propName}['${k}']`,
                            value: inputProp,
                            validator: config.validate.name,
                            desc: config.desc,
                            error: err,
                        });
                    }

                    if (!result) {
                        throw new AutoCastingError({
                            reason: `Rejected by validator ${config.validate.name}.`,
                            path: `${accessText}`,
                            hostName,
                            propName: `${propName}['${k}']`,
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

            values[k] = elem;
        }

        if (config.validateCollection) {
            const validators = Array.isArray(config.validateCollection) ?
                config.validateCollection : [config.validateCollection];

            for (const validator of validators) {
                const result = validator(values, input);

                if (!result) {
                    throw new AutoCastingError({
                        reason: `Rejected by collection validator ${config.validateCollection.name}.`,
                        path: `${accessText}`,
                        hostName,
                        propName,
                        value: dictInput,
                        validator: config.validateCollection.name,
                        desc: config.desc,
                    });
                }
            }
        }

        return values;
    }

    let item: any = NOT_RESOLVED;

    try {
        item = castToType(types, inputProp);
    } catch (err: any) {
        if (err.propName) {
            err.hostName = hostName;
            err.propName = `${propName}.${err.propName}`;
            err.path = `${accessText}.${err.path}`;
            err.message = makeAutoCastingErrorMessage(err);

            throw err;
        }
        if (inputProp !== undefined) {
            throw new AutoCastingError({
                reason: `Not within type [${typeNames.join('|')}].`,
                path: `${accessText}`,
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
        if ((typeof config.defaultFactory) === 'function') {
            return config.defaultFactory!.call(host, input, access);
        }

        if (config.required || inputProp !== undefined) {
            const typeNames = types.map((t: any) => (t.name ? t.name : t).toString());
            throw new AutoCastingError({
                reason: `Not within type [${typeNames.join('|')}].`,
                path: `${accessText}`,
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
                    path: `${accessText}`,
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
                    path: `${accessText}`,
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

export type Enum = Set<number | string> | { [k: string]: number | string;[w: number]: number | string; };

export interface PropOptions<T> {
    path?: string | symbol;
    type?: any | any[];
    arrayOf?: any | any[];
    dictOf?: any | any[];

    validate?: T extends Array<infer P> ?
    (val: P, obj?: any) => boolean | Array<(val: P, obj?: any) => boolean> :
    (val: T, obj?: any) => boolean | Array<(val: T, obj?: any) => boolean>;

    validateCollection?: T extends Array<any> ?
    (val: T, obj?: any) => boolean | Array<(val: T, obj?: any) => boolean> : any;

    required?: boolean;
    default?: T extends Array<infer P> ? P[] : T;
    defaultFactory?: (obj?: any, access?: string | symbol) => T extends Array<infer P> ? P[] : T;
    desc?: string;

    ext?: { [k: string]: any; };
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

    const typeAttrs = ['type', 'arrayOf', 'dictOf'] as ['type', 'arrayOf', 'dictOf'];

    for (const attr of typeAttrs) {
        const attrVal = options[attr];
        if (Array.isArray(attrVal)) {
            options[attr] = attrVal.map((x: unknown) => {
                if (_.isPlainObject(x)) {
                    // Its enum.
                    return enumToSet(x);
                } else if (x instanceof Set) {
                    x.toString = enumToString;
                }

                return x;
            });
        } else if (_.isPlainObject(attrVal)) {
            // Its enum.
            options[attr] = enumToSet(attrVal, designType);
        } else if (attrVal instanceof Set) {
            attrVal.toString = enumToString;
        }
    }

    return options;
}

export function Prop<T = any>(options: PropOptions<T> | string = {}) {
    const _options = typeof options === 'string' ? { path: options } : options;

    return function RPCParamPropDecorator(
        tgt: typeof AutoCastable.prototype, propName: string
    ) {
        if (!tgt[AUTOCASTABLE_OPTIONS_SYMBOL]) {
            tgt[AUTOCASTABLE_OPTIONS_SYMBOL] = {};
        } else if (!tgt.hasOwnProperty(AUTOCASTABLE_OPTIONS_SYMBOL)) {
            tgt[AUTOCASTABLE_OPTIONS_SYMBOL] = Object.create(tgt[AUTOCASTABLE_OPTIONS_SYMBOL]!);
        }

        const hostConfig = tgt[AUTOCASTABLE_OPTIONS_SYMBOL]!;

        _options.path = _options.path || propName;

        // design:type come from TypeScript compile time decorator-metadata.
        const designType = Reflect.getMetadata('design:type', tgt, propName);

        if (!_options.type && !_options.arrayOf) {
            _options.type = designType;
        }

        hostConfig[propName] = __patchPropOptionsEnumToSet(_options, designType);
    };
}

export function Also<T = any>(options: AdditionalPropOptions<T> = {}) {

    return function RPCParamPropDecorator(
        _tgt: typeof AutoCastable
    ) {
        const tgt = _tgt.prototype;
        if (!tgt[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]) {
            tgt[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL] = {};
        } else if (!tgt.hasOwnProperty(AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL)) {
            tgt[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL] = Object.create(tgt[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]!);
        }

        const hostConfig = tgt[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]!;

        __patchPropOptionsEnumToSet(hostConfig, options.dictOf);
    };
}
