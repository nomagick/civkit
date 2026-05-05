import type { ZodType, z } from 'zod';
import type { ZodArray, ZodIntersection, ZodObject, ZodUnion } from 'zod';
import {
    COERCIBLE_ADDITIONAL_OPTIONS_SYMBOL, COERCIBLE_OPTIONS_SYMBOL, Also, Coercible,
    CoercibleMetaClass, AutoConstructor, Constructor, PropOptions, isCoercibleClass, isZodType,
    InternalAdditionalPropOptions
} from "./coercible";
import { describeType } from './coercible-utils';
import type { Combine as _Combine, MangledConstructor } from './coercible-utils';
import { chainEntriesDesc, chainEntriesSimple, reverseObjectKeys } from '../../utils/lang';
import _ from 'lodash';

export interface InternalAdditionalPropOptionsWithZod<T> extends InternalAdditionalPropOptions<T> {
    zod?: ZodObject<any> | ZodArray<any> | ZodUnion<any> | ZodIntersection<any, any>;
}

export function CastZod<T extends ZodType>(z: T) {

    @Also({ zod: z })
    class Zod extends Coercible {
        @AutoConstructor
        static override from(input: any, ...args: any[]) {
            const zodPart = z.parse(input);

            const CoerciblePart = super.from(this, input, ...args);

            const ownProps = Object.assign({}, CoerciblePart);
            if (typeof zodPart === 'object' && zodPart) {
                Object.assign(CoerciblePart, zodPart, ownProps);
            }

            return CoerciblePart;
        }
    }

    Object.defineProperty(Zod, 'name', {
        value: describeType(Zod),
        writable: false,
    });

    return Zod as typeof Coercible & Constructor<T['_output']>;
}

function getMappedZodType(cls: Function | Set<unknown> | ZodType, yourZod: typeof z) {
    switch (cls) {
        case String: {
            return yourZod.string();
        }
        case Number: {
            return yourZod.number();
        }
        case Boolean: {
            return yourZod.boolean();
        }
        case Array: {
            return yourZod.array(yourZod.any());
        }
        case BigInt: {
            return yourZod.bigint();
        }
        case Symbol: {
            return yourZod.symbol();
        }
        case Function:
        case Object: {
            return yourZod.any();
        }
        case Date: {
            return yourZod.date();
        }
        case null: {
            return yourZod.null();
        }
        default: {
            if (cls instanceof Set) {
                return yourZod.enum(Array.from(cls.values()) as any);
            }

            if (isZodType(cls)) {
                return cls as ZodType;
            }

            if (isCoercibleClass(cls)) {
                return toZod(cls as typeof CoercibleMetaClass, yourZod);
            }

            return yourZod.unknown();
        }
    }

}

export function toZod<T extends typeof CoercibleMetaClass>(cls: T, yourZod: typeof z) {
    const zodOpts: { [k: string | symbol]: ZodType; } = {};

    for (const [k, v] of chainEntriesSimple(cls?.[COERCIBLE_OPTIONS_SYMBOL] || {})) {
        const opt: PropOptions<unknown> = v;
        let zs;

        if (opt.arrayOf) {
            if (Array.isArray(opt.arrayOf)) {
                zs = yourZod.union(opt.arrayOf.map((x) => getMappedZodType(x, yourZod)) as any);
            } else {
                zs = getMappedZodType(opt.arrayOf, yourZod);
            }
            if (opt.validate) {
                zs = zs.refine(opt.validate);
            }
            if (opt.memberNullable) {
                zs = zs.nullable();
            }

            zs = zs.array();

            if (opt.validateCollection) {
                zs = zs.refine(opt.validateCollection);
            }

        } else if (opt.dictOf) {
            if (Array.isArray(opt.dictOf)) {
                zs = yourZod.union(opt.dictOf.map((x) => getMappedZodType(x, yourZod)) as any);
            } else {
                zs = getMappedZodType(opt.dictOf, yourZod);
            }
            if (opt.validate) {
                zs = zs.refine(opt.validate);
            }
            if (opt.memberNullable) {
                zs = zs.nullable();
            }
            zs = yourZod.record(yourZod.string(), zs);

            if (opt.validateCollection) {
                zs = zs.refine(opt.validateCollection);
            }

        } else if (opt.type) {
            if (Array.isArray(opt.type)) {
                zs = yourZod.union(opt.type.map((x) => getMappedZodType(x, yourZod)) as any);
            } else {
                zs = getMappedZodType(opt.type, yourZod);
            }
            if (opt.validate) {
                zs = zs.refine(opt.validate);
            }
        } else {
            continue;
        }

        if (!opt.required) {
            zs = zs.optional();
        }

        if (opt.nullable) {
            zs = zs.nullable();
        }

        if (opt.defaultFactory) {
            zs = zs.default(opt.defaultFactory);
        } else if (opt.default) {
            zs = zs.default(opt.default);
        }

        if (opt.desc) {
            zs = zs.describe(opt.desc);
        }

        if (opt.path) {
            zodOpts[opt.path] = zs;
        } else {
            zodOpts[k] = zs;
        }
    }

    let zo: ZodType = yourZod.object(zodOpts);

    const additionalOpt = (cls?.[COERCIBLE_ADDITIONAL_OPTIONS_SYMBOL] || {}) as InternalAdditionalPropOptionsWithZod<unknown>;

    if (additionalOpt.dictOf) {
        let za;
        if (Array.isArray(additionalOpt.dictOf)) {
            za = yourZod.union(additionalOpt.dictOf.map((x) => getMappedZodType(x, yourZod)) as any);
        } else {
            za = getMappedZodType(additionalOpt.dictOf, yourZod);
        }

        if (additionalOpt.validate) {
            za = za.refine(additionalOpt.validate);
        }
        if (additionalOpt.memberNullable) {
            za = za.nullable();
        }
        za = yourZod.record(yourZod.string(), za);
        if (additionalOpt.validateCollection) {
            za = za.refine(additionalOpt.validateCollection);
        }

        zo = zo.and(za);
    }

    if (additionalOpt.arrayOf) {
        let za;
        if (Array.isArray(additionalOpt.arrayOf)) {
            za = yourZod.union(additionalOpt.arrayOf.map((x) => getMappedZodType(x, yourZod)) as any);
        } else {
            za = getMappedZodType(additionalOpt.arrayOf, yourZod);
        }
        if (additionalOpt.validate) {
            za = za.refine(additionalOpt.validate);
        }
        if (additionalOpt.memberNullable) {
            za = za.nullable();
        }
        za = za.array();
        if (additionalOpt.validateCollection) {
            za = za.refine(additionalOpt.validateCollection);
        }

        zo = zo.and(za);
    }

    if (additionalOpt.type) {
        let za;
        if (Array.isArray(additionalOpt.type)) {
            za = yourZod.union(additionalOpt.type.map((x) => getMappedZodType(x, yourZod)) as any);
        } else {
            za = getMappedZodType(additionalOpt.type, yourZod);
        }

        if (additionalOpt.validate) {
            za = za.refine(additionalOpt.validate);
        }

        zo = zo.and(za);
    }

    if (additionalOpt.zod) {
        zo = zo.and(additionalOpt.zod);
    }

    if (additionalOpt.desc) {
        zo.describe(additionalOpt.desc);
    }

    return zo;
}

export function Combine<T extends typeof CoercibleMetaClass[]>(
    ...autoCastableClasses: T
): _Combine<T> {
    const argArr = autoCastableClasses;
    if (argArr.length === 0) {
        throw new Error('At least one argument is required');
    }
    if (argArr.length === 1) {
        return argArr[0] as any;
    }

    const arr = argArr.reverse();

    const opts: { [k: string | symbol]: PropOptions<unknown>; } = {};
    const extOpts: InternalAdditionalPropOptionsWithZod<unknown> & { type?: any; arrayOf?: any; } = {};
    class NaivelyMergedClass extends Coercible {
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
        for (const [k, v] of chainEntriesSimple((cls as any)?.[COERCIBLE_OPTIONS_SYMBOL] || {})) {
            partialOpts[k] = { ...v, partOf: cls.name };
        }
        Object.assign(opts, reverseObjectKeys(partialOpts));

        const sourceOpts: InternalAdditionalPropOptionsWithZod<unknown> = (cls as any)?.[COERCIBLE_ADDITIONAL_OPTIONS_SYMBOL] || {};
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
            if ((k === COERCIBLE_OPTIONS_SYMBOL) || (k === COERCIBLE_OPTIONS_SYMBOL)) {
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
        [COERCIBLE_OPTIONS_SYMBOL]: {
            value: reverseObjectKeys(opts),
            configurable: true,
            enumerable: false,
            writable: false,
        },
        [COERCIBLE_ADDITIONAL_OPTIONS_SYMBOL]: {
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

export function Omit<T extends typeof CoercibleMetaClass, P extends (keyof InstanceType<T>)[]>(
    cls: T, ...props: P
): MangledConstructor<T, Omit<InstanceType<T>, typeof props[number]>> {
    if (!props.length) {
        return cls as any;
    }
    const opts: { [k: string | symbol]: PropOptions<unknown>; } = {};
    const extOpts: InternalAdditionalPropOptionsWithZod<unknown> = {};
    abstract class PartialClass extends cls { }

    for (const [k, v] of chainEntriesSimple(cls?.[COERCIBLE_OPTIONS_SYMBOL] || {})) {
        if (props.includes(k as any)) {
            continue;
        }
        opts[k] = { ...v, partOf: cls.name };
    }
    Object.assign(extOpts, cls?.[COERCIBLE_ADDITIONAL_OPTIONS_SYMBOL] || {});

    Object.defineProperties(PartialClass, {
        [COERCIBLE_OPTIONS_SYMBOL]: {
            value: opts,
            configurable: true,
            enumerable: false,
            writable: false,
        },
        [COERCIBLE_ADDITIONAL_OPTIONS_SYMBOL]: {
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

export function Pick<T extends typeof CoercibleMetaClass, P extends (keyof InstanceType<T>)[]>(
    cls: T, ...props: P
): MangledConstructor<T, Pick<InstanceType<T>, typeof props[number]>> {
    if (!props.length) {
        return cls as any;
    }
    const opts: { [k: string | symbol]: PropOptions<unknown>; } = {};
    const extOpts: InternalAdditionalPropOptionsWithZod<unknown> = {};
    abstract class PartialClass extends cls { }

    const sourceOpts = cls?.[COERCIBLE_OPTIONS_SYMBOL] || {};
    for (const k of props) {
        const sourceOpt = sourceOpts[k];
        if (!sourceOpt) {
            continue;
        }
        opts[k] = { ...sourceOpt, partOf: cls.name };
    }
    Object.assign(extOpts, cls?.[COERCIBLE_ADDITIONAL_OPTIONS_SYMBOL] || {});

    Object.defineProperties(PartialClass, {
        [COERCIBLE_OPTIONS_SYMBOL]: {
            value: opts,
            configurable: true,
            enumerable: false,
            writable: false,
        },
        [COERCIBLE_ADDITIONAL_OPTIONS_SYMBOL]: {
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

export {
    MangledConstructor,
    CombineEnum,
    Required,
    Literal,
    ArrayOf,
    DictOf,
    OneOf,
    describeType,
    JSONPrimitive,
} from './coercible-utils';
