import _ from 'lodash';
import type { ZodIntersection, ZodObject } from 'zod';
import {
    AdditionalPropOptions, Also, AutoCastable, AutoCastableMetaClass,
    AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL, AUTOCASTABLE_OPTIONS_SYMBOL,
    AutoConstructor, castToType, Constructor, Prop, PropOptions, __patchTypesEnumToSet, InternalAdditionalPropOptions, isZodType
} from './auto-castable';
import { chainEntriesDesc, chainEntriesSimple, isPrimitiveType, reverseObjectKeys } from '../../utils/lang';

export type MangledConstructor<T extends Constructor<any>, F> = {
    [k in keyof T]: T[k];
} & Constructor<F>;

export type Combine<T extends Function[]> =
    T extends [infer A, ...infer B] ?
    ((A extends Constructor<any> ? A : never) &
        (B extends Constructor<any>[] ? Combine<B> : never)) :
    (T extends readonly [infer D] ? (D extends Constructor<any> ? D : never) : unknown);

export function Combine<T extends typeof AutoCastableMetaClass[]>(
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
    const extOpts: InternalAdditionalPropOptions<unknown> & { type?: any; arrayOf?: any; } = {};
    class NaivelyMergedClass extends AutoCastable {
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
        for (const [k, v] of chainEntriesSimple((cls as any)?.[AUTOCASTABLE_OPTIONS_SYMBOL] || {})) {
            partialOpts[k] = { ...v, partOf: cls.name };
        }
        Object.assign(opts, reverseObjectKeys(partialOpts));

        const sourceOpts: InternalAdditionalPropOptions<unknown> = (cls as any)?.[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL] || {};
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

        if (sourceOpts.zod) {
            if (extOpts.zod) {
                if ((extOpts.zod as ZodObject<any>).shape && (sourceOpts.zod as ZodObject<any>).shape) {
                    extOpts.zod = (extOpts.zod as ZodObject<any>).merge(sourceOpts.zod as ZodObject<any>);
                } else {
                    extOpts.zod = (extOpts.zod as ZodIntersection<any, any>).and(sourceOpts.zod);
                }
            } else {
                extOpts.zod = sourceOpts.zod;
            }
        }

        for (const [k, desc] of chainEntriesDesc(cls.prototype, 'With Symbol')) {
            Object.defineProperty(NaivelyMergedClass.prototype, k, desc);
        }

        for (const [k, desc] of chainEntriesDesc(cls, 'With Symbol')) {
            if ((k === AUTOCASTABLE_OPTIONS_SYMBOL) || (k === AUTOCASTABLE_OPTIONS_SYMBOL)) {
                continue;
            }
            Object.defineProperty(NaivelyMergedClass, k, desc);
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
            value: extOpts,
            configurable: true,
            enumerable: false,
            writable: false,
        },
    });

    Object.defineProperty(NaivelyMergedClass, 'name', {
        value: `${argArr.map((x) => x.name).reverse().join('&')}`,
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
    const extOpts: InternalAdditionalPropOptions<unknown> = {};
    abstract class PartialClass extends cls { }

    for (const [k, v] of chainEntriesSimple(cls?.[AUTOCASTABLE_OPTIONS_SYMBOL] || {})) {
        opts[k] = { ...v, partOf: cls.name, required: false };
    }
    Object.assign(extOpts, cls?.[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL] || {});

    Object.defineProperties(PartialClass, {
        [AUTOCASTABLE_OPTIONS_SYMBOL]: {
            value: opts,
            configurable: true,
            enumerable: false,
            writable: false,
        },
        [AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]: {
            value: extOpts,
            configurable: true,
            enumerable: false,
            writable: false,
        },
    });
    if (extOpts.zod && isZodType(extOpts.zod) && (extOpts.zod as ZodObject<any>).shape) {
        extOpts.zod = (extOpts.zod as ZodObject<any>).partial();
    }

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
    const extOpts: InternalAdditionalPropOptions<unknown> = {};
    abstract class RequiredClass extends cls { }

    for (const [k, v] of chainEntriesSimple(cls?.[AUTOCASTABLE_OPTIONS_SYMBOL] || {})) {
        opts[k] = { ...v, partOf: cls.name, required: true };
    }
    Object.assign(extOpts, cls?.[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL] || {});

    Object.defineProperties(RequiredClass, {
        [AUTOCASTABLE_OPTIONS_SYMBOL]: {
            value: opts,
            configurable: true,
            enumerable: false,
            writable: false,
        },
        [AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]: {
            value: extOpts,
            configurable: true,
            enumerable: false,
            writable: false,
        },
    });

    if (extOpts.zod && isZodType(extOpts.zod) && (extOpts.zod as ZodObject<any>).shape) {
        extOpts.zod = (extOpts.zod as ZodObject<any>).required();
    }

    Object.defineProperty(RequiredClass, 'name', {
        value: `Required<${cls.name}>`,
        writable: false,
    });

    requiredTrackMap.set(cls, RequiredClass);

    return RequiredClass as any;
}

export function Omit<T extends typeof AutoCastableMetaClass, P extends (keyof InstanceType<T>)[]>(
    cls: T, ...props: P
): MangledConstructor<T, Omit<InstanceType<T>, typeof props[number]>> {
    if (!props.length) {
        return cls as any;
    }
    const opts: { [k: string | symbol]: PropOptions<unknown>; } = {};
    const extOpts: InternalAdditionalPropOptions<unknown> = {};
    abstract class PartialClass extends cls { }

    for (const [k, v] of chainEntriesSimple(cls?.[AUTOCASTABLE_OPTIONS_SYMBOL] || {})) {
        if (props.includes(k as any)) {
            continue;
        }
        opts[k] = { ...v, partOf: cls.name };
    }
    Object.assign(extOpts, cls?.[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL] || {});

    Object.defineProperties(PartialClass, {
        [AUTOCASTABLE_OPTIONS_SYMBOL]: {
            value: opts,
            configurable: true,
            enumerable: false,
            writable: false,
        },
        [AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]: {
            value: extOpts,
            configurable: true,
            enumerable: false,
            writable: false,
        },
    });

    if (extOpts.zod && isZodType(extOpts.zod) && (extOpts.zod as ZodObject<any>).shape) {
        const p: Record<typeof props[number], true> = {} as any;
        for (const x of props) {
            p[x] = true;
        }
        extOpts.zod = (extOpts.zod as ZodObject<any>).omit(props as any);
    }

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
    const extOpts: InternalAdditionalPropOptions<unknown> = {};
    abstract class PartialClass extends cls { }

    const sourceOpts = cls?.[AUTOCASTABLE_OPTIONS_SYMBOL] || {};
    for (const k of props) {
        const sourceOpt = sourceOpts[k];
        if (!sourceOpt) {
            continue;
        }
        opts[k] = { ...sourceOpt, partOf: cls.name };
    }
    Object.assign(extOpts, cls?.[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL] || {});

    Object.defineProperties(PartialClass, {
        [AUTOCASTABLE_OPTIONS_SYMBOL]: {
            value: opts,
            configurable: true,
            enumerable: false,
            writable: false,
        },
        [AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]: {
            value: extOpts,
            configurable: true,
            enumerable: false,
            writable: false,
        },
    });

    if (extOpts.zod && isZodType(extOpts.zod) && (extOpts.zod as ZodObject<any>).shape) {
        const p: Record<typeof props[number], true> = {} as any;
        for (const x of props) {
            p[x] = true;
        }
        extOpts.zod = (extOpts.zod as ZodObject<any>).pick(props as any);
    }

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
    class AnonCls extends AutoCastable {
    }

    for (const [k, v] of chainEntriesSimple(literal)) {
        Prop({ type: v })(AnonCls.prototype, k);
    }
    if (additionalOpts) {
        Also(additionalOpts)(AnonCls);
    }

    Object.defineProperty(AnonCls, 'name', {
        value: describeType(AnonCls),
        writable: false,
    });

    return AnonCls as any;
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
    class ArrayClass extends AutoCastable {
        constructor() {
            super();

            return new Array(...arguments);
        }

        @AutoConstructor
        static override from(input: any) {
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
    class OneOfClass extends AutoCastable {
        @AutoConstructor
        static override from(input: any) {
            return castToType(patchedClasses, input);
        }
    }

    Object.defineProperty(OneOfClass, 'name', {
        value: `${patchedClasses.map(describeType).join('|')}`,
        writable: false,
    });

    return OneOfClass as any;
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



export type JSONPrimitive = string | number | boolean | undefined | null;
export const JSONPrimitive = function () {
    @Also({ type: [String, Number, Boolean, undefined, null] })
    class _JSONPrimitive extends AutoCastable {
        @AutoConstructor
        static override from(input: any) {
            if (typeof input === 'object') {
                if (input !== null) {
                    return `${input}`;
                }
            }

            return input;
        }
    }
    Object.defineProperty(_JSONPrimitive, 'name', {
        value: `JSONPrimitive`,
        writable: false,
    });

    return _JSONPrimitive as any as JSONPrimitive;
}();

