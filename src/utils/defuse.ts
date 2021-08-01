import { mapValues, toPairs, fromPairs } from 'lodash';

export function defuse<T>(promise: Promise<T>) {
    return new Promise((resolve, _reject) => {
        promise.then(resolve, () => resolve(null));
    });
}


export type Defuse<T> = {
    [P in keyof T]: T[P] extends Promise<infer L> ? Promise<L | null> : T[P];
};

export function defuseObj<T extends object>(obj: T): Defuse<T> {
    return mapValues(obj as any, (x) => {
        if (x && typeof x.catch === 'function') {
            return x.catch(() => null);
        }

        return x;
    }) as any;
}

export type SafeAwait<T> = {
    [P in keyof T]: T[P] extends Promise<infer L> ? L : T[P];
};

export async function safeAwaitObj<T extends object>(obj: T): Promise<SafeAwait<T>> {
    const defused = defuseObj(obj);

    return fromPairs(await Promise.all(toPairs(defused).map(async ([k, v]) => [k, await v]))) as any;
}

export async function awaitObj<T extends object>(obj: T): Promise<SafeAwait<T>> {
    return fromPairs(await Promise.all(toPairs(obj).map(async ([k, v]) => [k, await v]))) as any;
}
