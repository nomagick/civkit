import type { ZodType, z } from 'zod';
import {
    AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL, AUTOCASTABLE_OPTIONS_SYMBOL, Also, AutoCastable,
    AutoCastableMetaClass, AutoConstructor, Constructor, PropOptions, isAutoCastableClass, isZodType
} from "./auto-castable";
import { describeType } from './auto-castable-utils';
import { chainEntriesSimple } from '../utils/lang';

export function CastZod<T extends ZodType>(z: T) {

    @Also({ zod: z })
    class Zod extends AutoCastable {
        @AutoConstructor
        static override from(input: any, ...args: any[]) {
            const zodPart = z.parse(input);

            const autoCastablePart = super.from(this, input, ...args);

            const ownProps = Object.assign({}, autoCastablePart);
            if (typeof zodPart === 'object' && zodPart) {
                Object.assign(autoCastablePart, zodPart, ownProps);
            }

            return autoCastablePart;
        }
    }

    Object.defineProperty(Zod, 'name', {
        value: describeType(Zod),
        writable: false,
    });

    return Zod as typeof AutoCastable & Constructor<T['_output']>;
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

            if (isAutoCastableClass(cls)) {
                return toZod(cls as typeof AutoCastableMetaClass, yourZod);
            }

            return yourZod.unknown();
        }
    }

}

export function toZod<T extends typeof AutoCastableMetaClass>(cls: T, yourZod: typeof z) {
    const zodOpts: { [k: string | symbol]: ZodType; } = {};

    for (const [k, v] of chainEntriesSimple(cls?.[AUTOCASTABLE_OPTIONS_SYMBOL] || {})) {
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

    const additionalOpt = cls?.[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL] || {};

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
