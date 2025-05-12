import _ from 'lodash';
import { inspect } from 'util';

export function isConstructor(f: any) {
    try {
        Reflect.construct(String, [], f);
    } catch (e) {
        return false;
    }
    return true;
}

export const NATIVE_CLASS_PROTOTYPES = new Map();

Object.getOwnPropertyNames(global).forEach((k) => {
    try {
        const v = Reflect.get(global, k);
        if (isConstructor(v)) {
            NATIVE_CLASS_PROTOTYPES.set(v.prototype, v);
        }
    } catch (_err) {
        // ignore
        // As of node 18.12 `wasi` is a dead trap in global.
        // Looks like Node.js bug.
    }
});

const sampleClass = class _sample { };

export function chainStringProps(o: object) {
    const keySet = new Set<string>();
    let ptr = o;
    const chain: Array<[string, any, PropertyDescriptor]> = [];

    while (ptr) {
        if (NATIVE_CLASS_PROTOTYPES.has(ptr)) {
            break;
        }
        const ptrIsConstructor = isConstructor(ptr);
        const keys = Object.getOwnPropertyNames(ptr);
        for (const x of keys) {
            if (keySet.has(x)) {
                continue;
            }
            const desc = Object.getOwnPropertyDescriptor(ptr, x);
            if (!desc || (!desc.enumerable && !ptrIsConstructor) || (ptrIsConstructor && sampleClass.hasOwnProperty(x))) {
                continue;
            }
            chain.push([x, Reflect.get(ptr, x), desc]);
            keySet.add(x);
        }
        ptr = Object.getPrototypeOf(ptr);
    }

    return chain;
}

export function chainSymbolProps(o: object) {
    const symbolSet = new Set<symbol>();
    let ptr = o;
    const chain: Array<[symbol, any, PropertyDescriptor]> = [];

    while (ptr) {
        const symbols = Object.getOwnPropertySymbols(ptr);
        for (const x of symbols) {
            if (symbolSet.has(x)) {
                continue;
            }
            const desc = Object.getOwnPropertyDescriptor(ptr, x);
            if (!(desc?.enumerable)) {
                continue;
            }
            chain.push([x, Reflect.get(ptr, x), desc]);
            symbolSet.add(x);
        }
        ptr = Object.getPrototypeOf(ptr);
    }

    return chain;
}

export function chainEntries(o: object): Array<[string, any, PropertyDescriptor]>;
export function chainEntries(o: object, withSymbol: true | string): Array<[string | symbol, any, PropertyDescriptor]>;
export function chainEntries(o: object, withSymbol?: true | string) {
    const r = chainStringProps(o) as Array<[string | symbol, any, PropertyDescriptor]>;

    return withSymbol ? r.concat(chainSymbolProps(o)) : r;
}

export function chainEntriesSimple(o: object) {
    const keySet = new Set<string>();
    let ptr = o;
    const chain: Array<[string, any, PropertyDescriptor]> = [];

    while (ptr) {
        const descs = Object.getOwnPropertyDescriptors(ptr);
        for (const [k, v] of Object.entries(descs)) {
            if (keySet.has(k)) {
                continue;
            }
            if (typeof k === 'symbol' || !v.enumerable) {
                continue;
            }
            chain.push([k, Reflect.get(ptr, k), v]);
            keySet.add(k);
        }
        ptr = Object.getPrototypeOf(ptr);
    }

    return chain;
}

export function chainStringPropsDesc(o: object) {
    const keySet = new Set<string>();
    let ptr = o;
    const chain: Array<[string, PropertyDescriptor]> = [];

    while (ptr) {
        if (NATIVE_CLASS_PROTOTYPES.has(ptr)) {
            break;
        }
        const ptrIsConstructor = isConstructor(ptr);
        const ptrIsPrototypeObject = isConstructor(ptr?.constructor);
        const keys = Object.getOwnPropertyNames(ptr);
        for (const x of keys) {
            if (keySet.has(x)) {
                continue;
            }
            const desc = Object.getOwnPropertyDescriptor(ptr, x);
            if (!desc ||
                (!desc.enumerable && !(ptrIsConstructor || ptrIsPrototypeObject)) ||
                (ptrIsConstructor && sampleClass.hasOwnProperty(x)) ||
                (ptrIsPrototypeObject && sampleClass.prototype.hasOwnProperty(x))
            ) {
                continue;
            }
            chain.push([x, desc]);
            keySet.add(x);
        }
        ptr = Object.getPrototypeOf(ptr);
    }

    return chain;
}

export function chainSymbolPropsDesc(o: object) {
    const symbolSet = new Set<symbol>();
    let ptr = o;
    const chain: Array<[symbol, PropertyDescriptor]> = [];

    while (ptr) {
        const symbols = Object.getOwnPropertySymbols(ptr);
        for (const x of symbols) {
            if (symbolSet.has(x)) {
                continue;
            }
            const desc = Object.getOwnPropertyDescriptor(ptr, x);
            if (!(desc?.enumerable)) {
                continue;
            }
            chain.push([x, desc]);
            symbolSet.add(x);
        }
        ptr = Object.getPrototypeOf(ptr);
    }

    return chain;
}

export function chainEntriesDesc(o: object): Array<[string, PropertyDescriptor]>;
export function chainEntriesDesc(o: object, withSymbol: true | string): Array<[string | symbol, PropertyDescriptor]>;
export function chainEntriesDesc(o: object, withSymbol?: true | string) {
    const r = chainStringPropsDesc(o) as Array<[string | symbol, PropertyDescriptor]>;

    return withSymbol ? r.concat(chainSymbolPropsDesc(o)) : r;
}

export function digConstructablePrototype(o: object) {
    if (typeof o !== 'object' || o === null) {
        return undefined;
    }

    let ptr = o;

    while (ptr) {
        ptr = Object.getPrototypeOf(ptr);
        if (ptr === null) {
            return undefined;
        }
        if (typeof ptr.constructor === 'function') {
            break;
        }
    }

    return ptr;
}

const PRIMITIVE_TYPES = new Set([String, Number, Boolean, Symbol, BigInt, Object, null, undefined]);
export function isPrimitiveType(t: any) {
    return PRIMITIVE_TYPES.has(t);
}

export function isPrimitiveLike(o: any, ...primitivePrototypeSets: Array<Set<object>>) {
    const constructablePrototype = digConstructablePrototype(o);

    if (!constructablePrototype) {
        return true;
    }

    if (constructablePrototype === Object.prototype || constructablePrototype === Array.prototype) {
        return false;
    }

    if (NATIVE_CLASS_PROTOTYPES.has(constructablePrototype)) {
        return true;
    }

    for (const set of primitivePrototypeSets) {
        if (set.has(constructablePrototype)) {
            return true;
        }
    }

    return false;
}

export function stringifyErrorLike(err: Error | { [k: string]: any; } | string | null | undefined) {
    if (!err) {
        return 'null';
    }

    if (typeof err === 'string') {
        return err;
    }

    if (err instanceof Error) {
        return err.toString();
    }

    return inspect(err, { depth: 6 });
}

export function marshalErrorLike(err: Error | { [k: string]: any; } | string | null | undefined) {
    if (!(err instanceof Error)) {
        return err;
    }

    let r;
    if (typeof (err as any).toJSON === 'function') {
        r = (err as any).toJSON();
    } else {
        r = { ...err, name: err.name, message: err.message };
    }

    if (r?.cause) {
        r.cause = marshalErrorLike(r.cause);
    }

    return r;
}

export function sortObjectKeys(input: object) {
    return _(input).toPairs().sortBy(0).fromPairs().value();
}

export function reverseObjectKeys(input: object) {
    return _(input).toPairs().reverse().fromPairs().value();
}

export function parseUrl(input: string) {
    try {
        return new URL(input);
    } catch (err) {
        return undefined;
    }
}

export function carefulAssign(target: object, source: object) {
    for (const [k, desc] of Object.entries(Object.getOwnPropertyDescriptors(source))) {
        const currentDesc = Object.getOwnPropertyDescriptor(target, k);

        if (!currentDesc) {
            Object.defineProperty(target, k, desc);
            continue;
        }

        if (currentDesc.configurable === false) {
            continue;
        }

        if (currentDesc.get || currentDesc.set) {
            continue;
        }

        Reflect.set(target, k, Reflect.get(source, k));
    }
}

export function strongerAssign(target: object, source: object) {
    for (const [k, desc] of Object.entries(Object.getOwnPropertyDescriptors(source))) {
        const currentDesc = Object.getOwnPropertyDescriptor(target, k);

        if (!currentDesc) {
            Object.defineProperty(target, k, desc);
            continue;
        }

        if (currentDesc.configurable === false) {
            continue;
        }

        if (currentDesc.get || currentDesc.set) {
            continue;
        }

        Object.defineProperty(target, k, desc);
    }
}

