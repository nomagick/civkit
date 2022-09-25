import _ from 'lodash';
import { inspect } from 'util';

export function isConstructor(f: Function) {
    try {
        Reflect.construct(String, [], f);
    } catch (e) {
        return false;
    }
    return true;
}

export function chainKeys(o: object) {
    const keySet = new Set<string>();

    let ptr = o;

    while (ptr) {
        for (const x of Object.keys(ptr)) {
            keySet.add(x);
        }

        ptr = Object.getPrototypeOf(ptr);
    }

    return Array.from(keySet);
}

export function chainEntries(o: object) {
    return chainKeys(o).map((x) => [x, (o as any)[x]]);
}

export const NATIVE_CLASS_PROTOTYPES = new Map();

Object.getOwnPropertyNames(global).forEach((k) => {
    const v = Reflect.get(global, k);
    if (isConstructor(v)) {
        NATIVE_CLASS_PROTOTYPES.set(v.prototype, v);
    }
});

export function topLevelConstructorOf(o: object) {

    switch (typeof o) {
        case 'function': {
            return Function;
        }
        case 'undefined': {
            return undefined;
        }
        case 'number': {
            return Number;
        }
        case 'string': {
            return String;
        }
        case 'symbol': {
            return Symbol;
        }
        case 'boolean': {
            return Boolean;
        }
        case 'object': {
            let ptr = o;

            while (ptr) {
                ptr = Object.getPrototypeOf(ptr);

                if (ptr === null) {
                    return null;
                }
                if (!ptr) {
                    return undefined;
                }
                if (NATIVE_CLASS_PROTOTYPES.has(ptr)) {
                    return ptr.constructor;
                }
            }
            break;
        }

        default: {
            return undefined;
        }
    }

    return undefined;
}

export function formatDateUTC(date: Date) {
    return `${date.getUTCFullYear()}${(date.getUTCMonth() + 1).toString().padStart(2, '0')}${date
        .getUTCDate()
        .toString()
        .padStart(2, '0')}`;
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

    if (typeof (err as any).toJSON === 'function') {
        return (err as any).toJSON();
    }

    return { ...err, name: err.name, message: err.message };
}

export function sortObjectKeys(input: object) {
    return _(input).toPairs().sortBy(0).fromPairs().value();
}
