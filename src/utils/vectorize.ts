import _ from 'lodash';

import { chainEntries, topLevelConstructorOf } from './lang';

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

function _vectorize2(obj: object, stack: string[] = [], mode: 'array' | 'inherited' = 'inherited') {
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
            if (_.isPlainObject(v) || Array.isArray(v)) {
                vectors.push([stack.concat(k).join('.'), deepSurface(v)]);
                continue;
            }
            if (
                typeof v === 'object' &&
                v !== null
            ) {
                const topLevelConstructor = topLevelConstructorOf(v);
                if (topLevelConstructor === Object) {
                    vectors.push(..._vectorize2(v, stack.concat(k)));
                } else if (topLevelConstructor === Array) {
                    vectors.push(..._vectorize2(v, stack.concat(k), 'array'));
                } else if (topLevelConstructor) {
                    vectors.push([stack.concat(k).join('.'), v]);
                }
                continue;
            }

            vectors.push([stack.concat(k).join('.'), v]);
            continue;
        }

        if (
            typeof v === 'object' && v !== null
        ) {
            const topLevelConstructor = topLevelConstructorOf(v);
            if (topLevelConstructor === Object) {
                vectors.push(..._vectorize2(v, stack.concat(k)));
            } else if (topLevelConstructor === Array) {
                vectors.push(..._vectorize2(v, stack.concat(k), 'array'));
            } else if (topLevelConstructor) {
                vectors.push([stack.concat(k).join('.'), v]);
            }

            continue;
        }
    }

    return vectors;
}

export function vectorize2(obj: object) {
    return _.fromPairs(_vectorize2(obj)) as { [k: string]: any; };
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

export function deepCreate(source: object): any {
    const clone: any = Array.isArray(source) ? [...source] : { ...source };

    for (const [k, v] of Object.entries(source)) {
        if (_.isObjectLike(v)) {
            clone[k] = deepCreate(v);
        }
    }

    const result = Object.create(clone);

    return result;
}

export function deepSurface(source: any): any {
    if (typeof source !== 'object' || source === null) {
        return source;
    }

    const topLevelConstructor = topLevelConstructorOf(source);
    if (topLevelConstructor === Array) {
        return (source as Array<any>).map((x) => (_.isPlainObject(x) ? x : deepSurface(x)));
    }

    if (topLevelConstructor !== Object) {
        return source;
    }

    const clone: any = {};

    for (const [k, v] of chainEntries(source)) {
        clone[k] = deepSurface(v);
    }

    return clone;
}

export function deepClean<T>(object: T): Partial<T> {
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
