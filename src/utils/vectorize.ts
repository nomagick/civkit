import _ from 'lodash';

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
    if (Array.isArray(source)) {
        return source.map((x) => (_.isPlainObject(x) ? deepCreate(x) : x));
    }

    const result = Object.create(source);

    for (const [k, v] of Object.entries(source)) {
        if (_.isPlainObject(v)) {
            result[k] = deepCreate(v);
        }
    }

    return result;
}
