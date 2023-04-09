import _ from 'lodash';
import {
    AdditionalPropOptions, Also, AutoCastable, AutoCastableMetaClass,
    AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL, AUTOCASTABLE_OPTIONS_SYMBOL,
    AutoConstructor, castToType, Constructor, Prop, PropOptions, __patchTypesEnumToSet
} from './auto-castable';
import { chainEntries, isPrimitiveType, reverseObjectKeys } from '../utils';

export type MangledConstructor<T extends Constructor<any>, F> = {
    [k in keyof T]: T[k];
} & Constructor<F>;

export type Combine<T extends Constructor<any>[]> =
    T extends [infer A, ...infer B] ?
    ((A extends Constructor<any> ? A : never) &
        (B extends Constructor<any>[] ? Combine<B> : never)) :
    (T extends readonly [infer D] ? (D extends Constructor<any> ? D : never) : unknown);

export function Combine<T extends Constructor<any>[]>(
    ...autoCastableClasses: T
): Combine<T> {
    const argArr = autoCastableClasses;
    if (argArr.length === 0) {
        throw new Error('At least one argument is required');
    }
    if (argArr.length === 1) {
        return argArr[0] as any;
    }

    const arr = argArr.reverse();

    const opts: { [k: string | symbol]: PropOptions<unknown>; } = {};
    const extOpts: AdditionalPropOptions<unknown> & { type?: any; arrayOf?: any; } = {};
    class NaivelyMergedClass extends AutoCastableMetaClass {
        constructor(...args: any[]) {
            super();
            for (const cls of arr) {
                cls.constructor.call(this, ...args);
            }

            return this as any;
        }
    }

    for (const cls of arr) {
        const partialOpts: any = {};
        for (const [k, v] of chainEntries((cls as any)?.[AUTOCASTABLE_OPTIONS_SYMBOL] || {})) {
            partialOpts[k] = { ...v, partOf: cls.name };
        }
        Object.assign(opts, reverseObjectKeys(partialOpts));

        const sourceOpts: any = (cls as any)?.[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL] || {};
        _.merge(extOpts, _.cloneDeep(_.omit(sourceOpts, 'type', 'arrayOf', 'dictOf', 'openapi', 'desc')));
        if (sourceOpts.desc) {
            extOpts.desc = extOpts.desc ? `${extOpts.desc}\n\n${sourceOpts.desc}` : sourceOpts.desc;
        }
        const openapiConf = _.get(sourceOpts, 'openapi') || _.get(sourceOpts, 'ext.openapi');
        if (openapiConf) {
            extOpts.openapi = _.mergeWith(extOpts.openapi || {}, _.cloneDeep(openapiConf), (v1, v2, key) => {
                if (key === 'desc' || key === 'description') {
                    if (v1 && v2) {
                        return `${v1}\n\n${v2}`;
                    }

                    return v1 || v2;
                }
            });
        }
        for (const prop of ['type', 'arrayOf', 'dictOf'] as const) {
            if (!sourceOpts[prop]) {
                continue;
            }
            const arrOpts = Array.isArray(sourceOpts[prop]) ? [...sourceOpts[prop]] : [sourceOpts[prop]];
            if (!extOpts[prop]) {
                extOpts[prop] = arrOpts;
            } else if (Array.isArray(extOpts[prop])) {
                extOpts[prop].push(...arrOpts);
                extOpts[prop] = _.uniq([...extOpts[prop], ...arrOpts]);
            } else {
                extOpts[prop] = _.uniq([extOpts[prop], ...arrOpts]);
            }
        }

        for (const [k, v, desc] of chainEntries(cls.prototype, 'With Symbol')) {
            Object.defineProperty(NaivelyMergedClass.prototype, k, desc || { value: v, enumerable: true });
        }

        for (const [k, v, desc] of chainEntries(cls, 'With Symbol')) {
            if ((k === AUTOCASTABLE_OPTIONS_SYMBOL) || (k === AUTOCASTABLE_OPTIONS_SYMBOL)) {
                continue;
            }
            Object.defineProperty(NaivelyMergedClass, k, desc || { value: v, enumerable: true });
        }
    }

    if (argArr.includes(Object as any)) {
        if (!extOpts.dictOf) {
            extOpts.dictOf = Object;
        } else if (Array.isArray(extOpts.dictOf) && !extOpts.dictOf.includes(Object)) {
            extOpts.dictOf.push(Object);
        }
    }

    Object.defineProperties(NaivelyMergedClass, {
        [AUTOCASTABLE_OPTIONS_SYMBOL]: {
            value: reverseObjectKeys(opts),
            configurable: true,
            enumerable: false,
            writable: false,
        },
        [AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]: {
            value: reverseObjectKeys(extOpts),
            configurable: true,
            enumerable: false,
            writable: false,
        },
    });

    Object.defineProperty(NaivelyMergedClass, 'name', {
        value: `${argArr.map((x) => x.name).join('&')}`,
        writable: false,
    });

    return NaivelyMergedClass as any;
}

export type CombineEnum<T extends Record<string, string>[]> =
    T extends [infer A, ...infer B] ?
    (A |
        (B extends Record<string, string>[] ? CombineEnum<B> : never)) :
    (T extends readonly [infer D] ? D : never);

export function CombineEnum<T extends Record<string, string>[]>(...enums: T): CombineEnum<T> {
    const ret: Record<string, string> = {};
    for (const e of enums) {
        Object.assign(ret, e);
    }

    return ret as CombineEnum<T>;
}

const partialTrackMap = new WeakMap<AutoCastableMetaClass, AutoCastableMetaClass>();
export function Partial<T extends typeof AutoCastableMetaClass>(
    cls: T
): MangledConstructor<T, Partial<InstanceType<T>>> {
    if (partialTrackMap.has(cls)) {
        return partialTrackMap.get(cls) as any;
    }
    const opts: { [k: string | symbol]: PropOptions<unknown>; } = {};
    const extOpts: AdditionalPropOptions<unknown> = {};
    abstract class PartialClass extends cls { }

    const partialOpts: any = {};
    for (const [k, v] of chainEntries(cls?.[AUTOCASTABLE_OPTIONS_SYMBOL] || {})) {
        partialOpts[k] = { ...v, partOf: cls.name, required: false };
    }
    Object.assign(opts, reverseObjectKeys(partialOpts));
    Object.assign(extOpts, cls?.[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL] || {});

    Object.defineProperties(PartialClass, {
        [AUTOCASTABLE_OPTIONS_SYMBOL]: {
            value: reverseObjectKeys(opts),
            configurable: true,
            enumerable: false,
            writable: false,
        },
        [AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]: {
            value: reverseObjectKeys(extOpts),
            configurable: true,
            enumerable: false,
            writable: false,
        },
    });

    Object.defineProperty(PartialClass, 'name', {
        value: `Partial<${cls.name}>`,
        writable: false,
    });

    partialTrackMap.set(cls, PartialClass);

    return PartialClass as any;
}

const requiredTrackMap = new WeakMap<AutoCastableMetaClass, AutoCastableMetaClass>();
export function Required<T extends typeof AutoCastableMetaClass>(
    cls: T
): MangledConstructor<T, Required<InstanceType<T>>> {
    if (requiredTrackMap.has(cls)) {
        return requiredTrackMap.get(cls) as any;
    }
    const opts: { [k: string | symbol]: PropOptions<unknown>; } = {};
    const extOpts: AdditionalPropOptions<unknown> = {};
    abstract class PartialClass extends cls { }

    const partialOpts: any = {};
    for (const [k, v] of chainEntries(cls?.[AUTOCASTABLE_OPTIONS_SYMBOL] || {})) {
        partialOpts[k] = { ...v, partOf: cls.name, required: true };
    }
    Object.assign(opts, reverseObjectKeys(partialOpts));
    Object.assign(extOpts, cls?.[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL] || {});

    Object.defineProperties(PartialClass, {
        [AUTOCASTABLE_OPTIONS_SYMBOL]: {
            value: reverseObjectKeys(opts),
            configurable: true,
            enumerable: false,
            writable: false,
        },
        [AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]: {
            value: reverseObjectKeys(extOpts),
            configurable: true,
            enumerable: false,
            writable: false,
        },
    });

    Object.defineProperty(PartialClass, 'name', {
        value: `Partial<${cls.name}>`,
        writable: false,
    });

    requiredTrackMap.set(cls, PartialClass);

    return PartialClass as any;
}

export function Omit<T extends typeof AutoCastableMetaClass, P extends (keyof InstanceType<T>)[]>(
    cls: T, ...props: P
): MangledConstructor<T, Omit<InstanceType<T>, typeof props[number]>> {
    if (!props.length) {
        return cls as any;
    }
    const opts: { [k: string | symbol]: PropOptions<unknown>; } = {};
    const extOpts: AdditionalPropOptions<unknown> = {};
    abstract class PartialClass extends cls { }

    const partialOpts: any = {};
    for (const [k, v] of chainEntries(cls?.[AUTOCASTABLE_OPTIONS_SYMBOL] || {})) {
        if (props.includes(k as any)) {
            continue;
        }
        partialOpts[k] = { ...v, partOf: cls.name };
    }
    Object.assign(opts, reverseObjectKeys(partialOpts));
    Object.assign(extOpts, cls?.[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL] || {});

    Object.defineProperties(PartialClass, {
        [AUTOCASTABLE_OPTIONS_SYMBOL]: {
            value: reverseObjectKeys(opts),
            configurable: true,
            enumerable: false,
            writable: false,
        },
        [AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]: {
            value: reverseObjectKeys(extOpts),
            configurable: true,
            enumerable: false,
            writable: false,
        },
    });

    Object.defineProperty(PartialClass, 'name', {
        value: `Omit<${cls.name}, ${props.join('|')}>`,
        writable: false,
    });

    return PartialClass as any;
}

export function Pick<T extends typeof AutoCastableMetaClass, P extends (keyof InstanceType<T>)[]>(
    cls: T, ...props: P
): MangledConstructor<T, Pick<InstanceType<T>, typeof props[number]>> {
    if (!props.length) {
        return cls as any;
    }
    const opts: { [k: string | symbol]: PropOptions<unknown>; } = {};
    const extOpts: AdditionalPropOptions<unknown> = {};
    abstract class PartialClass extends cls { }

    const sourceOpts = cls?.[AUTOCASTABLE_OPTIONS_SYMBOL] || {};
    for (const k of props) {
        opts[k] = { ...sourceOpts[k], partOf: cls.name };
    }
    Object.assign(extOpts, cls?.[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL] || {});

    Object.defineProperties(PartialClass, {
        [AUTOCASTABLE_OPTIONS_SYMBOL]: {
            value: reverseObjectKeys(opts),
            configurable: true,
            enumerable: false,
            writable: false,
        },
        [AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]: {
            value: reverseObjectKeys(extOpts),
            configurable: true,
            enumerable: false,
            writable: false,
        },
    });

    Object.defineProperty(PartialClass, 'name', {
        value: `Pick<${cls.name}, ${props.join('|')}>`,
        writable: false,
    });

    return PartialClass as any;
}

export function Literal<T extends Record<string | symbol, Constructor<any> | object>, P = unknown>(
    literal: T, additionalOpts?: AdditionalPropOptions<P>
): Constructor<
    {
        [k in keyof T]?: T[k] extends Constructor<infer U> ? U : T[k];
    }
> & (typeof AutoCastable) {
    class LiteralClass extends AutoCastable {
    }

    for (const [k, v] of chainEntries(literal)) {
        Prop({ type: v })(LiteralClass.prototype, k);
    }
    if (additionalOpts) {
        Also(additionalOpts)(LiteralClass);
    }

    Object.defineProperty(LiteralClass, 'name', {
        value: AutoCastable.name,
        writable: false,
    });

    return LiteralClass as any;
}

export function ArrayOf<P extends (Constructor<any> | object)[]>(...classes: P): Constructor<
    Array<typeof classes[number] extends Constructor<infer P> ? P : typeof classes[number]>>
    & (typeof AutoCastableMetaClass) & {
        from(input: any): Array<typeof classes[number] extends Constructor<infer P> ? P : typeof classes[number]>;
    } {
    if (!classes.length) {
        throw new Error('At least one argument is required');
    }

    const patchedClasses = __patchTypesEnumToSet(classes);

    @Also({ arrayOf: classes })
    class ArrayClass extends AutoCastableMetaClass {
        constructor() {
            super();

            return new Array(...arguments);
        }

        @AutoConstructor
        static from(input: any) {
            if (input?.[Symbol.iterator]) {
                if (typeof input === 'string') {
                    return [castToType(patchedClasses, input)];
                }
                return Array.from(input).map((x) => castToType(patchedClasses, x));
            }

            return [castToType(patchedClasses, input)];
        }
    }

    Object.defineProperty(ArrayClass, 'name', {
        value: `Array<${patchedClasses.map(describeType).join('|')}>`,
        writable: false,
    });

    return ArrayClass as any;
}

export function DictOf<T extends (Constructor<any> | object)[]>(...classes: T): Constructor<
    Record<string | symbol, typeof classes[number] extends Constructor<infer P> ? P : typeof classes[number]>
> & (typeof AutoCastable) {
    if (!classes.length) {
        throw new Error('At least one argument is required');
    }

    const patchedClasses = __patchTypesEnumToSet(classes);

    @Also({ dictOf: classes })
    class DictClass extends AutoCastable { }

    Object.defineProperty(DictClass, 'name', {
        value: `Record<string|symbol, ${patchedClasses.map(describeType).join('|')}>`,
        writable: false,
    });

    return DictClass as any;
}

export function OneOf<T extends Constructor<any>[]>(...classes: T): Constructor<
    typeof classes[number] extends Constructor<infer P> ? P : typeof classes[number]
> & (typeof AutoCastable) {
    if (!classes.length) {
        throw new Error('At least one argument is required');
    }
    if (classes.length === 1) {
        return classes[0] as any;
    }

    const patchedClasses = __patchTypesEnumToSet(classes);

    @Also({ type: classes })
    class DictClass extends AutoCastableMetaClass {
        @AutoConstructor
        static from(input: any) {
            return castToType(patchedClasses, input);
        }
    }

    Object.defineProperty(DictClass, 'name', {
        value: `${patchedClasses.map(describeType).join('|')}`,
        writable: false,
    });

    return DictClass as any;
}

const TYPE_NAME_MAP = new WeakMap<any, string>();
const TYPE_NAME_SET = new Set<string>();
const NAME_FINALIZATION_REGISTRY = new FinalizationRegistry((x: string) => {
    TYPE_NAME_SET.delete(x);
});
let trackCounter = 1n;

function hexRepresent(n: bigint) {
    const buff = Buffer.alloc(8);
    buff.writeBigUInt64LE(n);

    return `0x${buff.toString('hex')}`.replace(/(00)+$/, '');
}
export function describeType(x: any) {
    if (!x) {
        return `${x}`;
    }

    if (TYPE_NAME_MAP.has(x)) {
        return TYPE_NAME_MAP.get(x)!;
    }

    trackCounter += 1n;
    let name = `${x}`;

    if (typeof x === 'function' && x.name) {
        name = `${x.name}@${hexRepresent(trackCounter)}`;

        if (isPrimitiveType(x)) {
            name = `${x.name}`.toLowerCase();
        }
    } else if (x instanceof Set) {
        name = `enum@${hexRepresent(trackCounter)}`;
    }

    if (TYPE_NAME_MAP.has(x)) {
        // Conflict
        if (typeof x === 'function') {
            name = `${name}@${hexRepresent(trackCounter)}`;
        } else if (x instanceof Set) {
            name = `enum@${hexRepresent(trackCounter)}`;
        } else {
            name = `object@${hexRepresent(trackCounter)}`;
        }
    }

    TYPE_NAME_MAP.set(x, name);
    TYPE_NAME_SET.add(name);
    NAME_FINALIZATION_REGISTRY.register(x, name);

    return name;
}
