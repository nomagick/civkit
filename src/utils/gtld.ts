import { parse_host } from 'tld-extract';

const globalCache = new Map<string, string | undefined>([
    ['localhost', 'localhost']
]);

export function topLevelDomain(hostname: string) {
    if (globalCache.has(hostname)) {
        return globalCache.get(hostname);
    }

    let r;
    try {
        r = parse_host(hostname, { allowPrivateTLD: true, allowUnknownTLD: true });
    } catch (err) {
        // swallow
    }

    globalCache.set(hostname, r?.domain);

    return r?.domain;
}
