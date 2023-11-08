import 'reflect-metadata';
import { isConstructor, chainEntriesSimple } from '../utils/lang';

import _ from 'lodash';

export const AUTO_CONSTRUCTOR_SYMBOL = Symbol('AutoConstructor');
export const AUTOCASTABLE_OPTIONS_SYMBOL = Symbol('AutoCastable options');
export const AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL = Symbol('AutoCastable additional options');

export const NOT_RESOLVED = Symbol('Not-Resolved');

export type AdditionalPropOptions<T> = Pick<
    PropOptions<T>,
    | 'dictOf'
    | 'validate'
    | 'validateCollection'
    | 'memberNullable'
    | 'desc'
    | 'openapi'
    | 'ext'
>;

export type InternalAdditionalPropOptions<T> = AdditionalPropOptions<T> & Pick<PropOptions<T>,
    | 'type'
    | 'arrayOf'
>;

export type Constructor<T> = { new(...args: any[]): T; };
export type Constructed<T> = T extends Partial<infer U> ? U : T extends object ? T : object;

export class AutoCastableMetaClass {
    static [AUTOCASTABLE_OPTIONS_SYMBOL]?: { [k: string | symbol]: PropOptions<unknown>; };
    static [AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]?: InternalAdditionalPropOptions<unknown>;

    constructor(..._args: any[]) {
        return this as any;
    }
}

export type AutoConstructorType<T extends Constructor<unknown>> =
    (this: T, input: any, ...args: ConstructorParameters<T>) => InstanceType<T>;

/**
 * Retrieve and verify an object based on the props (required, type, default and so on)
 */
export function autoConstructor<T extends AutoCastableMetaClass>(
    this: Constructor<T>, input: any, ...args: ConstructorParameters<typeof this>
): T;
export function autoConstructor<T extends AutoCastableMetaClass>(
    this: Constructor<Partial<T>>, input: any, ...args: ConstructorParameters<typeof this>
): T;
export function autoConstructor<T, U extends Constructor<AutoCastableMetaClass>>(
    this: U, input: T, ...args: ConstructorParameters<typeof this>
): Constructed<T>;
export function autoConstructor(
    this: typeof AutoCastableMetaClass, input: object, ...args: unknown[]
) {
    const instance = new (this as any)(...args);

    const entryVecs = chainEntriesSimple((this as typeof AutoCastableMetaClass)[AUTOCASTABLE_OPTIONS_SYMBOL] || {});

    for (const [prop, config] of entryVecs) {
        const val = inputSingle(undefined, input, prop, config, this);
        if (val === undefined) {
            continue;
        }
        (instance as any)[prop] = val;
    }

    if (this[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]) {
        const additionalConf = this[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL];
        if (additionalConf?.dictOf && _.isObjectLike(input)) {
            const namedEntryKeys = entryVecs.map(([k]) => k);
            const dict = inputSingle(undefined, _.omit(input, ...namedEntryKeys), undefined, additionalConf, this);

            Object.assign(instance, dict);
        }
        if (additionalConf?.validate && !additionalConf.dictOf) {
            const validators = Array.isArray(additionalConf.validate) ? additionalConf.validate : [additionalConf.validate];

            for (const validator of validators) {
                let result;
                try {
                    result = (validator as Function).call(this, instance, input);
                } catch (err: any) {
                    throw new AutoCastingError({
                        reason: `Validator '${describeAnonymousValidateFunction(validator)}' has thrown an error: ${errorMessageOf(err)}.`,
                        path: makePropNameArr(undefined, undefined, undefined),
                        hostName: this.name,
                        propName: makePropNameArr(undefined, undefined, undefined),
                        value: input,
                        validator: describeAnonymousValidateFunction(validator),
                        desc: additionalConf.desc,
                        cause: err,
                    });
                }

                if (result instanceof Error) {
                    throw new AutoCastingError({
                        reason: `Rejected by validator '${describeAnonymousValidateFunction(validator)}': ${errorMessageOf(result)}.`,
                        path: makePropNameArr(undefined, undefined, undefined),
                        hostName: this.name,
                        propName: makePropNameArr(undefined, undefined, undefined),
                        value: input,
                        validator: describeAnonymousValidateFunction(validator),
                        desc: additionalConf.desc,
                        cause: result,
                    });
                }

                if (!result) {
                    throw new AutoCastingError({
                        reason: `Rejected by validator ${describeAnonymousValidateFunction(validator)}.`,
                        path: makePropNameArr(undefined, undefined, undefined),
                        hostName: this.name,
                        propName: makePropNameArr(undefined, undefined, undefined),
                        value: input,
                        validator: describeAnonymousValidateFunction(validator),
                        desc: additionalConf.desc,
                    });
                }
            }
        }
    }

    return instance as any;
}

export class AutoCastable implements AutoCastableMetaClass {
    static [AUTOCASTABLE_OPTIONS_SYMBOL]?: { [k: string | symbol]: PropOptions<unknown>; };
    static [AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]?: InternalAdditionalPropOptions<unknown>;

    @AutoConstructor
    static from = autoConstructor;

    constructor(..._args: any[]) {
        return this as any;
    }
}

export function isAutoConstructable(cls: any): boolean {
    if (!cls) {
        return false;
    }
    const autoConstructorIdentifier = Reflect.get(cls, AUTO_CONSTRUCTOR_SYMBOL);
    const autoConstructorFunc = Reflect.get(cls, autoConstructorIdentifier);

    if (typeof autoConstructorFunc === 'function') {
        return true;
    }

    return false;
}

export function autoConstruct<T extends Constructor<unknown>>(cls: T, input: any, ...args: ConstructorParameters<T>[]) {
    const autoConstructorIdentifier = Reflect.get(cls, AUTO_CONSTRUCTOR_SYMBOL) as string | symbol;
    const autoConstructorFunc = (Reflect.get(cls, autoConstructorIdentifier) || autoConstructor) as Function;

    return autoConstructorFunc.call(cls, input, ...args) as InstanceType<T>;
}

export function AutoConstructor<T extends Constructor<any>>(tgt: T, propName: string | symbol) {
    Object.defineProperty(
        tgt,
        AUTO_CONSTRUCTOR_SYMBOL,
        { value: propName, enumerable: false, configurable: true, writable: false }
    );
}

export function isAutoCastableClass(cls: any): boolean {
    if (!cls) {
        return false;
    }

    if (
        cls.prototype instanceof AutoCastable ||
        cls.prototype instanceof AutoCastableMetaClass ||
        isAutoConstructable(cls) ||
        (cls?.[AUTOCASTABLE_OPTIONS_SYMBOL] || cls?.[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL])
    ) {
        return true;
    }

    return false;
}

export class AutoCastingError extends Error {
    path: string;
    desc?: string;
    value: any;
    types: string[];
    hostName?: string;
    propName: string;
    reason: string;

    get error() {
        return this.cause;
    }
    set error(input: unknown) {
        this.cause = input;
    }

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
    const compPath = (err.path && err.propName) ?
        (err.path === err.propName ?
            `(${err.path})` :
            `(${err.path} => ${err.propName})`) :
        '';
    return `At #${err.hostName || 'input'}${compPath}: ${err.reason[0]?.toUpperCase()}${err.reason.substring(1)}`;
}

const TRUE_VALUES = new Set([true, 'TRUE', 'true', 'True', 1, '1']);
const FALSE_VALUES = new Set([false, 'FALSE', 'false', 'False', 0, '0']);

export function castToType(ensureTypes: any[], inputProp: any) {
    let val: any = NOT_RESOLVED;
    let lastErr: Error | undefined | unknown;
    if (inputProp === undefined) {
        if (ensureTypes.includes(Object) || ensureTypes.includes(undefined)) {
            return undefined;
        }

        return NOT_RESOLVED;
    }

    theLoop:
    for (const typeShouldBe of ensureTypes) {
        // AutoCastable types
        if (isAutoCastableClass(typeShouldBe)) {
            if (inputProp instanceof typeShouldBe) {
                val = inputProp;
                break;
            }

            try {
                val = autoConstruct(typeShouldBe, inputProp);
                break;
            } catch (err) {
                lastErr = err;
                continue;
            }

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
                if (TRUE_VALUES.has(inputProp)) {
                    val = true;
                    break theLoop;
                } else if (FALSE_VALUES.has(inputProp)) {
                    val = false;
                    break theLoop;
                } else if (inputProp === '') {
                    // Empty string may be cast to false. However if String type is allowed, it should be left as string.
                    val = ensureTypes.includes(String) ? inputProp : false;
                    break theLoop;
                }
                continue theLoop;
            }

            // Object/Array/Function is the type of all mixed/any/T[] types.
            case Array: {
                if (Array.isArray(inputProp)) {
                    val = inputProp;
                } else {
                    val = [inputProp];
                }

                break theLoop;
            }
            case Function:
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

function makePropName(superName?: string, propName?: string | symbol, objIdx?: string | symbol) {
    let [p1, p2, p3] = ['', '', ''];

    if (propName) {
        p1 = `${propName.toString()}`;
    }

    if (objIdx) {
        p2 = `${p1 ? '.' : ''}${objIdx.toString()}`;
    }

    if (superName) {
        p3 = `${(p1 || p2) ? '.' : ''}${superName}`;
    }

    return `${p1}${p2}${p3}`;
}

function makePropNameArr(superName?: string, propName?: string | symbol, arrIdx?: number | string) {
    let [p1, p2, p3] = ['', '', ''];
    if (superName) {
        p3 = `.${superName}`;
    }
    if (propName && !(typeof propName === 'symbol' && propName.description?.toLowerCase().includes('root'))) {
        p1 = `${propName.toString()}`;
    }

    if (arrIdx || arrIdx === 0) {
        p2 = `[${arrIdx.toString()}]`;
    }

    return `${p1}${p2}${p3}`;
}

export function inputSingle<T>(
    hostName: string | undefined, input: any, prop: string | symbol | undefined, config: PropOptions<T>, host?: Function
) {
    let types: any;
    let isArray = false;
    let isDict = false;
    const access = config.path || prop;
    const propName = prop?.toString() || '';
    const accessText = access ? access.toString() : '';

    const inputProp = access === undefined ? input : _.get(input, access);

    if (config.arrayOf) {
        isArray = true;
        types = Array.isArray(config.arrayOf) ? config.arrayOf : [config.arrayOf];
    } else if (config.dictOf) {
        isDict = true;
        types = Array.isArray(config.dictOf) ? config.dictOf : [config.dictOf];
    } else if (config.type) {
        if (config.type === Array) {
            isArray = true;
            types = [Object];
        } else {
            types = Array.isArray(config.type) ? config.type : [config.type];
        }
    } else {
        throw new Error(`Type info not provided${accessText ? `: ${accessText}` : `: ${hostName}`}`);
    }

    const typeNames = types.map((t: any) => {
        if (t === null) {
            return 'null';
        }
        return (t.name ? t.name : t).toString();
    });


    if (inputProp === undefined) {
        if (config.default !== undefined) {
            if (Array.isArray(config.default)) {
                return [...config.default];
            }
            if (_.isPlainObject(config.default)) {
                return { ...config.default };
            }

            return config.default;
        }
        if ((typeof config.defaultFactory) === 'function') {
            return config.defaultFactory!.call(undefined, input, access);
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
        if (config.nullable) {
            return null;
        }

        return undefined;
    }

    if (isArray) {
        if (inputProp === undefined) {
            return undefined;
        }

        const memberNullable = Boolean(config.memberNullable);
        const arrayInput = Array.isArray(inputProp) ? inputProp : [inputProp];

        const values: T[] = [];

        for (const [i, x] of arrayInput.entries()) {
            if (memberNullable && x === null) {
                values.push(null as any);
                continue;
            }
            let elem: any = NOT_RESOLVED;
            try {
                elem = castToType(types, x);
            } catch (err: any) {
                if (err.propName || err.path) {
                    err.hostName = hostName;
                    err.propName = makePropNameArr(err.propName, propName, i);
                    err.path = makePropNameArr(err.path, accessText, i);
                    err.message = makeAutoCastingErrorMessage(err);

                    throw err;
                }

                throw new AutoCastingError({
                    reason: `Type casting failed [${typeNames.join('|')}]: ${err}.`,
                    path: `${accessText}[${i}]`,
                    hostName,
                    propName: makePropNameArr(undefined, propName, i),
                    value: x,
                    types: typeNames,
                    cause: err,
                    desc: config.desc,
                });
            }

            if (elem === NOT_RESOLVED) {
                throw new AutoCastingError({
                    reason: `Type casting failed [${typeNames.join('|')}].`,
                    path: `${accessText}[${i}]`,
                    hostName,
                    propName: makePropNameArr(undefined, propName, i),
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
                        result = (validator as Function).call(host, elem, input);
                    } catch (err: any) {
                        throw new AutoCastingError({
                            reason: `Validator '${describeAnonymousValidateFunction(validator)}' has thrown an error: ${errorMessageOf(err)}.`,
                            path: makePropNameArr(undefined, accessText, i),
                            hostName,
                            propName: makePropNameArr(undefined, propName, i),
                            value: inputProp,
                            validator: describeAnonymousValidateFunction(validator),
                            desc: config.desc,
                            cause: err,
                        });
                    }

                    if (result instanceof Error) {
                        throw new AutoCastingError({
                            reason: `Rejected by validator '${describeAnonymousValidateFunction(validator)}': ${errorMessageOf(result)}.`,
                            path: makePropNameArr(undefined, accessText, i),
                            hostName,
                            propName: makePropNameArr(undefined, propName, i),
                            value: inputProp,
                            validator: describeAnonymousValidateFunction(validator),
                            desc: config.desc,
                            cause: result,
                        });
                    }

                    if (!result) {
                        throw new AutoCastingError({
                            reason: `Rejected by validator ${describeAnonymousValidateFunction(validator)}.`,
                            path: makePropNameArr(undefined, accessText, i),
                            hostName,
                            propName: makePropNameArr(undefined, propName, i),
                            value: inputProp,
                            validator: describeAnonymousValidateFunction(validator),
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
                let result;
                try {
                    result = (validator as Function).call(host, values, input);
                } catch (err: any) {
                    throw new AutoCastingError({
                        reason: `Collection validator '${describeAnonymousValidateFunction(validator)}' has thrown an error: ${errorMessageOf(err)}.`,
                        path: makePropNameArr(undefined, accessText),
                        hostName,
                        propName: makePropNameArr(undefined, propName),
                        value: arrayInput,
                        validator: describeAnonymousValidateFunction(validator),
                        desc: config.desc,
                        cause: err,
                    });
                }

                if (result instanceof Error) {
                    throw new AutoCastingError({
                        reason: `Rejected by collection validator '${describeAnonymousValidateFunction(validator)}': ${errorMessageOf(result)}.`,
                        path: makePropNameArr(undefined, accessText),
                        hostName,
                        propName: makePropNameArr(undefined, propName),
                        value: arrayInput,
                        validator: describeAnonymousValidateFunction(validator),
                        desc: config.desc,
                        cause: result,
                    });
                }

                if (!result) {
                    throw new AutoCastingError({
                        reason: `Rejected by collection validator ${describeAnonymousValidateFunction(validator)}.`,
                        path: makePropNameArr(undefined, accessText),
                        hostName,
                        propName: makePropNameArr(undefined, propName),
                        value: arrayInput,
                        validator: describeAnonymousValidateFunction(validator),
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

        const memberNullable = Boolean(config.memberNullable);
        const values: { [k: string]: T; } = {};

        for (const [k, v] of Object.entries(dictInput)) {
            if (memberNullable && v === null) {
                values[k] = null as any;
                continue;
            }

            let elem: any = NOT_RESOLVED;
            try {
                elem = castToType(types, v);
            } catch (err: any) {
                if (err.propName || err.path) {
                    err.hostName = hostName;
                    err.propName = makePropName(err.propName, propName, k);
                    err.path = makePropName(err.path, accessText, k);
                    err.message = makeAutoCastingErrorMessage(err);

                    throw err;
                }

                throw new AutoCastingError({
                    reason: `Type casting failed [${typeNames.join('|')}]: ${err}.`,
                    path: makePropName(undefined, accessText, k),
                    hostName,
                    propName: makePropName(undefined, propName, k),
                    value: v,
                    types: typeNames,
                    cause: err,
                    desc: config.desc,
                });
            }

            if (elem === NOT_RESOLVED) {
                throw new AutoCastingError({
                    reason: `Type casting failed [${typeNames.join('|')}].`,
                    path: makePropName(undefined, accessText, k),
                    hostName,
                    propName: makePropName(undefined, accessText, k),
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
                        result = (validator as Function).call(host, elem, input);
                    } catch (err: any) {
                        throw new AutoCastingError({
                            reason: `Validator '${describeAnonymousValidateFunction(validator)}' has thrown an error: ${errorMessageOf(err)}.`,
                            path: makePropName(undefined, accessText, k),
                            hostName,
                            propName: makePropName(undefined, propName, k),
                            value: inputProp,
                            validator: describeAnonymousValidateFunction(validator),
                            desc: config.desc,
                            cause: err,
                        });
                    }

                    if (result instanceof Error) {
                        throw new AutoCastingError({
                            reason: `Rejected by validator '${describeAnonymousValidateFunction(validator)}': ${errorMessageOf(result)}.`,
                            path: makePropName(undefined, accessText, k),
                            hostName,
                            propName: makePropName(undefined, propName, k),
                            value: inputProp,
                            validator: describeAnonymousValidateFunction(validator),
                            desc: config.desc,
                            cause: result,
                        });
                    }

                    if (!result) {
                        throw new AutoCastingError({
                            reason: `Rejected by validator ${describeAnonymousValidateFunction(validator)}.`,
                            path: makePropName(undefined, accessText, k),
                            hostName,
                            propName: makePropName(undefined, propName, k),
                            value: inputProp,
                            validator: describeAnonymousValidateFunction(validator),
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
                let result;
                try {
                    result = (validator as Function).call(host, values, input);
                } catch (err: any) {
                    throw new AutoCastingError({
                        reason: `Collection validator '${describeAnonymousValidateFunction(validator)}' has thrown an error: ${errorMessageOf(err)}.`,
                        path: makePropNameArr(undefined, accessText),
                        hostName,
                        propName: makePropNameArr(undefined, propName),
                        value: dictInput,
                        validator: describeAnonymousValidateFunction(validator),
                        desc: config.desc,
                        cause: err,
                    });
                }

                if (result instanceof Error) {
                    throw new AutoCastingError({
                        reason: `Rejected by collection validator '${describeAnonymousValidateFunction(validator)}': ${errorMessageOf(result)}.`,
                        path: makePropNameArr(undefined, accessText),
                        hostName,
                        propName: makePropNameArr(undefined, propName),
                        value: dictInput,
                        validator: describeAnonymousValidateFunction(validator),
                        desc: config.desc,
                        cause: result,
                    });
                }

                if (!result) {
                    throw new AutoCastingError({
                        reason: `Rejected by collection validator ${describeAnonymousValidateFunction(validator)}.`,
                        path: makePropNameArr(undefined, accessText),
                        hostName,
                        propName: makePropNameArr(undefined, propName),
                        value: dictInput,
                        validator: describeAnonymousValidateFunction(validator),
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
        if (err.propName || err.path) {
            err.hostName = hostName;
            err.propName = makePropName(err.propName, propName);
            err.path = makePropName(err.path, accessText);
            err.message = makeAutoCastingErrorMessage(err);

            throw err;
        }
        if (inputProp !== undefined) {
            throw new AutoCastingError({
                reason: `Type casting failed [${typeNames.join('|')}]: ${err}.`,
                path: makePropNameArr(undefined, accessText),
                hostName,
                propName: makePropNameArr(undefined, propName),
                value: inputProp,
                types: typeNames,
                cause: err,
                desc: config.desc,
            });
        }
    }

    if (item === NOT_RESOLVED || item === undefined) {
        if (config.required || inputProp !== undefined) {
            const typeNames = types.map((t: any) => (t.name ? t.name : t).toString());
            throw new AutoCastingError({
                reason: `Type casting failed [${typeNames.join('|')}].`,
                path: makePropNameArr(undefined, accessText),
                hostName,
                propName: makePropNameArr(undefined, propName),
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
                result = (validator as Function).call(host, item, input);
            } catch (err: any) {
                throw new AutoCastingError({
                    reason: `Validator '${describeAnonymousValidateFunction(validator)}' has thrown an error: ${errorMessageOf(err)}.`,
                    path: makePropNameArr(undefined, accessText),
                    hostName,
                    propName: makePropNameArr(undefined, propName),
                    value: inputProp,
                    validator: describeAnonymousValidateFunction(validator),
                    desc: config.desc,
                    cause: err,
                    readableMessage: err.message,
                });
            }

            if (!result) {
                throw new AutoCastingError({
                    reason: `Rejected by validator ${describeAnonymousValidateFunction(validator)}.`,
                    path: makePropNameArr(undefined, accessText),
                    hostName,
                    propName: makePropNameArr(undefined, propName),
                    value: inputProp,
                    validator: describeAnonymousValidateFunction(validator),
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
    (val: P, obj?: any) => Error | boolean | Array<(val: P, obj?: any) => Error | boolean> :
    (val: T, obj?: any) => Error | boolean | Array<(val: T, obj?: any) => Error | boolean>;

    validateCollection?: T extends Array<any> ?
    (val: T, obj?: any) => Error | boolean | Array<(val: T, obj?: any) => Error | boolean> : any;

    required?: boolean;
    default?: T extends Array<infer P> ? P[] : T;
    defaultFactory?: (this: undefined, obj?: any, access?: string | symbol) => T extends Array<infer P> ? P[] : T;
    desc?: string;
    markdown?: string;

    nullable?: boolean;
    memberNullable?: boolean;
    deprecated?: boolean;
    partOf?: string;

    openapi?: { [k: string]: any; };
    ext?: { [k: string]: any; };
}

const ENUM_TO_SET_MAP = new WeakMap<object, Set<string> | Set<number>>();

export function enumToSet(enumObj: object, _designType?: any) {
    if (ENUM_TO_SET_MAP.has(enumObj)) {
        return ENUM_TO_SET_MAP.get(enumObj)!;
    }

    const result = new Set<any>();
    for (const x of Object.values(enumObj as any)) {
        result.add(x as any);
    }

    result.toString = enumToString;

    ENUM_TO_SET_MAP.set(enumObj, result);

    return result;
}

function enumToString(this: Set<any>) {
    const members = Array.from(this.values());
    if (!members.length) {
        return 'Ø';
    }
    const str = members.map((x) => {
        if (typeof x === 'string') {
            return `"${x}"`;
        }
        return x;
    }).join(' | ');

    return `${str.length > 128 ? str.substring(0, 128) + '...' : str}`;
}

export function describeAnonymousValidateFunction(validator: Function) {
    if (typeof validator !== 'function') {
        return '';
    }

    if (validator.name && validator.name !== 'validate') {
        return validator.name;
    }

    const funcStr = validator.toString();

    return funcStr.replaceAll('\n', ' ').substring(0, 128);
}

function errorMessageOf(err: Error) {
    if (typeof err !== 'object' || err === null) {
        return `${err}`;
    }

    if (err.constructor === Error) {
        return err.message;
    }

    return err.toString();
}

export function __patchTypesEnumToSet(classes: any[]) {
    return classes.map((x) => {
        if (_.isPlainObject(x)) {
            // Its enum.
            return enumToSet(x);
        } else if (x instanceof Set) {
            x.toString = enumToString;
        }

        return x;
    });
}

export function __patchPropOptionsEnumToSet<T = any>(options: PropOptions<T>, designType?: any) {

    const typeAttrs = ['type', 'arrayOf', 'dictOf'] as const;

    for (const attr of typeAttrs) {
        const attrVal = options[attr];
        if (Array.isArray(attrVal)) {
            options[attr] = attrVal.map((x: unknown) => {
                if (_.isPlainObject(x)) {
                    // Its enum.
                    return enumToSet(x as object);
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

export function Prop<
    U = any,
    T extends typeof AutoCastableMetaClass = typeof AutoCastableMetaClass
>(options: PropOptions<U> | string = {}) {
    const _options = typeof options === 'string' ? { path: options } : options;

    return function RPCParamPropDecorator(
        tgt: T['prototype'], propName: string | symbol
    ) {
        const constructor = tgt.constructor as typeof AutoCastable;
        if (!constructor[AUTOCASTABLE_OPTIONS_SYMBOL]) {
            Object.defineProperty(constructor, AUTOCASTABLE_OPTIONS_SYMBOL, {
                value: {},
                configurable: true,
                enumerable: false,
                writable: false,
            });
        } else if (!constructor.hasOwnProperty(AUTOCASTABLE_OPTIONS_SYMBOL)) {
            Object.defineProperty(constructor, AUTOCASTABLE_OPTIONS_SYMBOL, {
                value: Object.create(constructor[AUTOCASTABLE_OPTIONS_SYMBOL]!),
                configurable: true,
                enumerable: false,
                writable: false,
            });
        }

        const hostConfig = constructor[AUTOCASTABLE_OPTIONS_SYMBOL]!;

        _options.path = _options.path || propName;

        // design:type come from TypeScript compile time decorator-metadata.
        const designType = Reflect.getMetadata('design:type', tgt, propName);

        if (!_options.type && !_options.arrayOf) {
            _options.type = designType;
        }

        hostConfig[propName] = __patchPropOptionsEnumToSet(_options, designType);
    };
}

export function Also<T = any>(
    options: AdditionalPropOptions<T> & { [k: string]: any; } = {}
) {
    return function RPCParamPropDecorator(
        tgt: typeof AutoCastableMetaClass
    ) {
        if (!tgt[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]) {
            Object.defineProperty(tgt, AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL, {
                value: {},
                configurable: true,
                enumerable: false,
                writable: false,
            });
        } else if (!tgt.hasOwnProperty(AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL)) {
            Object.defineProperty(tgt, AUTOCASTABLE_OPTIONS_SYMBOL, {
                value: Object.create(tgt[AUTOCASTABLE_OPTIONS_SYMBOL]!),
                configurable: true,
                enumerable: false,
                writable: false,
            });
        }

        const hostConfig = tgt[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]!;
        Object.assign(hostConfig, __patchPropOptionsEnumToSet(options));
    };
}
