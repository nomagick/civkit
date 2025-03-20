import _ from 'lodash';

import {
    chainEntriesSimple as chainEntries, isPrimitiveLike,
} from './lang';

function _vectorize(obj: object, stack: string[] = []) {
    const vectors: Array<[string, any]> = [];
    for (const x in obj) {
        if (obj.hasOwnProperty(x)) {
            const val = (obj as any)[x];
            if (
                val !== null &&
                typeof val === 'object' &&
                (Object.getPrototypeOf(val) === Object.prototype || Object.getPrototypeOf(val) === null)
            ) {
                vectors.push(..._vectorize(val, stack.concat(x)));
            } else {
                vectors.push([stack.concat(x).join('.'), val]);
            }
        }
    }

    return vectors;
}

export function vectorize(obj: object) {
    return _.fromPairs(_vectorize(obj)) as { [k: string]: any; };
}

export function _vectorize2(
    obj: object, stack: string[] = [], mode: 'array' | 'inherited' = 'inherited',
    ...additionalPrimitivePrototypeSets: Set<object>[]
): [string, any][] {
    const vectors: Array<[string, any]> = [];
    for (const [k, v] of chainEntries(obj)) {
        if (mode === 'array') {
            // Array is somewhat special
            if (k === 'length') {
                continue;
            }
            if (!obj.hasOwnProperty(k)) {
                continue;
            }
            vectors.push([stack.concat(k).join('.'), deepSurface(v)]);
            continue;
        }

        if (obj.hasOwnProperty(k)) {
            // Fall back to simple object whenever key contains dot or $
            // MongoDB cannot query keys with dot or $
            if (k.includes('.') || k.includes('$')) {
                return [[stack.join('.'), deepSurface(obj)]];
            }
            if (Array.isArray(v)) {
                vectors.push([stack.concat(k).join('.'), deepSurface(v)]);
                continue;
            }
            if (
                typeof v === 'object' &&
                v !== null
            ) {
                if (v instanceof Array) {
                    vectors.push(..._vectorize2(v, stack.concat(k), 'array', ...additionalPrimitivePrototypeSets));
                } else if (isPrimitiveLike(v, ...additionalPrimitivePrototypeSets)) {
                    vectors.push([stack.concat(k).join('.'), v]);
                } else {
                    vectors.push(..._vectorize2(v, stack.concat(k)));
                }

                continue;
            }

            vectors.push([stack.concat(k).join('.'), v]);
            continue;
        }

        if (
            typeof v === 'object' && v !== null
        ) {
            if (v instanceof Array) {
                vectors.push(..._vectorize2(v, stack.concat(k), 'array', ...additionalPrimitivePrototypeSets));
            } else if (isPrimitiveLike(v, ...additionalPrimitivePrototypeSets)) {
                vectors.push([stack.concat(k).join('.'), v]);
            } else {
                vectors.push(..._vectorize2(v, stack.concat(k), 'inherited', ...additionalPrimitivePrototypeSets));
            }

            continue;
        }
    }

    return vectors;
}

export function vectorize2(obj: object, ...additionalPrimitivePrototypeSets: Set<object>[]) {
    const vecs = _vectorize2(obj, undefined, undefined, ...additionalPrimitivePrototypeSets);

    if (vecs.length > 1) {
        return _.fromPairs(vecs);
    }

    if (!vecs.length) {
        return {};
    }

    const [k, v] = vecs[0];
    if (k) {
        return { [k]: v };
    }

    return v;
}

export function specialDeepVectorize(obj: object, stack: string[] = [], refStack: Set<any> = new Set()) {
    const vectors: Array<[string, any]> = [];
    if (!(obj && typeof obj.hasOwnProperty === 'function')) {
        return [];
    }
    if (obj instanceof Error) {
        Object.defineProperties(obj, {
            name: { enumerable: true },
            message: { enumerable: true },
        });
    }

    for (const x in obj) {
        // if (!obj.hasOwnProperty(x)) {
        //     continue;
        // }
        let val;
        try {
            val = (obj as any)[x];
        } catch (err) {
            // Maybe some kind of getter and it throws.
            val = null;
        }

        if (refStack.has(val)) {
            // Circular
            vectors.push([stack.concat(x).join('.'), val]);

            continue;
        }
        refStack.add(val);
        if (val !== null && (typeof val === 'object' || typeof val === 'function')) {
            if (!_.isPlainObject(val) && !_.isArray(val) && !_.isArguments(val)) {
                vectors.push([stack.concat(x).join('.'), val]);
            }

            vectors.push(...specialDeepVectorize(val, stack.concat(x), refStack));
        } else {
            vectors.push([stack.concat(x).join('.'), val]);
        }
    }

    return vectors;
}

export function parseJSONText(text?: string) {
    if (!text) {
        return text;
    }

    try {
        return JSON.parse(text);
    } catch (err) {
        return text;
    }
}


export function deepCreate(source: object, ...additionalPrimitivePrototypeSets: Set<object>[]): any {
    const isArray = Array.isArray(source);
    const clone: any = isArray ? [...source] : { ...source };

    for (const [k, v] of Object.entries(source)) {
        if (isPrimitiveLike(v, ...additionalPrimitivePrototypeSets)) {
            clone[k] = v;
            continue;
        }

        clone[k] = deepCreate(v, ...additionalPrimitivePrototypeSets);
    }

    const result = Object.create(clone);

    return result;
}

export function deepSurface(source: any, ...additionalPrimitivePrototypeSets: Set<object>[]): any {
    if (typeof source !== 'object' || source === null) {
        return source;
    }

    if (source instanceof Array) {
        return (source as Array<any>).map((x) => (_.isPlainObject(x) ? x : deepSurface(x)));
    }

    if (isPrimitiveLike(source, ...additionalPrimitivePrototypeSets)) {
        return source;
    }

    const clone: any = {};

    for (const [k, v] of chainEntries(source)) {
        clone[k] = deepSurface(v, ...additionalPrimitivePrototypeSets);
    }

    return clone;
}

export function deepClean<T extends object>(object: T): Partial<T> {
    for (const [k, v] of Object.entries(object)) {
        if (v === null || v === undefined) {
            delete (object as any)[k];
        } else if (_.isArray(v)) {
            for (const x of v) {
                if (_.isPlainObject(x) || _.isArray(x)) {
                    deepClean(x);
                }
            }
        } else if (_.isPlainObject(v)) {
            deepClean(v);
        }
    }

    return object as any;
}

export function deepClone(input: any, customizer?: (v: any) => any, db: WeakMap<any, any> = new WeakMap()) {
    if ((typeof input !== 'object' && typeof input !== 'function') || input === null) {
        return input;
    }

    if (db.has(input)) {
        return db.get(input);
    }

    if (customizer) {
        const result = customizer(input);
        if (result !== undefined) {
            db.set(input, result);

            return result;
        }
    }

    let clone: any;
    if (Array.isArray(input)) {
        clone = [...input];
    } else if (Buffer.isBuffer(input)) {
        clone = Buffer.from(input);
        db.set(input, clone);

        return clone;
    } else if (input instanceof Set) {
        clone = new Set();
        db.set(input, clone);
        for (const x of input) {
            clone.add(deepClone(x, customizer, db));
        }
    } else if (input instanceof Map) {
        clone = new Map();
        db.set(input, clone);
        for (const [k, v] of input.entries()) {
            clone.set(deepClone(k, customizer, db), deepClone(v, customizer, db));
        }
    } else {
        clone = Object.create(Object.getPrototypeOf(input) || null);
        db.set(input, clone);
    }

    for (const [k, desc] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
        if (desc.hasOwnProperty('value')) {
            desc.value = deepClone(desc.value, customizer, db);
        }

        try {
            Object.defineProperty(clone, k, desc);
        } catch (err) {
            void 0;
        }
    }

    return clone;
}

export function deepCloneAndExpose(input: any, customizer?: (v: any) => any, db: WeakMap<any, any> = new WeakMap()) {
    if ((typeof input !== 'object' && typeof input !== 'function') || input === null) {
        return input;
    }

    if (db.has(input)) {
        return db.get(input);
    }

    if (customizer) {
        const result = customizer(input);
        if (result !== undefined) {
            db.set(input, result);

            return result;
        }
    }

    let clone: any;
    if (Array.isArray(input)) {
        clone = [...input];
    } else if (Buffer.isBuffer(input)) {
        clone = Buffer.from(input);
        db.set(input, clone);

        return clone;
    } else if (input instanceof Set) {
        clone = new Set();
        db.set(input, clone);
        for (const x of input) {
            clone.add(deepCloneAndExpose(x, customizer, db));
        }
    } else if (input instanceof Map) {
        clone = new Map();
        db.set(input, clone);
        for (const [k, v] of input.entries()) {
            clone.set(deepCloneAndExpose(k, customizer, db), deepCloneAndExpose(v, customizer, db));
        }
    } else {
        clone = Object.create(Object.getPrototypeOf(input) || null);
        db.set(input, clone);
    }

    for (const [k, desc] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
        const copyDesc = { ...desc };
        if (desc.hasOwnProperty('value')) {
            copyDesc.value = deepCloneAndExpose(desc.value, customizer, db);
        }
        copyDesc.enumerable = true;
        copyDesc.writable = true;
        copyDesc.configurable = true;

        try {
            Object.defineProperty(clone, k, copyDesc);
        } catch (err) {
            void 0;
        }
    }

    return clone;
}
