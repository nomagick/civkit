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

export function formatDateUTC(date: Date) {
    return `${date.getUTCFullYear()}${(date.getUTCMonth() + 1).toString().padStart(2, '0')}${date.getUTCDate().toString().padStart(2, '0')}`;
}
