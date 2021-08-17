
import { LookupOptions, promises as pdns } from 'dns';
import _ from 'lodash';
import { isIPv4, isIPv6 } from 'net';

export function makeCustomDNSResolveFunc(options: { hosts?: { [k: string]: string | string[] }, servers?: string[], timeout?: number }) {

    const resolver = new pdns.Resolver({ timeout: options.timeout });
    if (options.servers) {
        resolver.setServers(options.servers);
    }
    const v4Hosts = new Map<string, string[]>();
    const v6Hosts = new Map<string, string[]>();
    if (options.hosts) {
        for (const [k, v] of Object.entries(options.hosts)) {
            if (Array.isArray(v)) {
                for (const x of v) {
                    if (isIPv4(x)) {
                        const s = v4Hosts.get(k);
                        if (s) {
                            s.push(x);
                        } else {
                            v4Hosts.set(k, [x]);
                        }
                    } else if (isIPv6(x)) {
                        const s = v4Hosts.get(k);
                        if (s) {
                            s.push(x);
                        } else {
                            v6Hosts.set(k, [x]);
                        }
                    }
                }

                continue;
            }

            if (isIPv4(v)) {
                v4Hosts.set(k, [v]);
            } else if (isIPv6(v)) {
                v6Hosts.set(k, [v]);
            }
        }
    }

    async function lookup(
        hostname: string,
        options: LookupOptions,
        callback: (err: NodeJS.ErrnoException | null, address?: string | Array<{ address: string; family: number }>, family?: number) => void
    ) {
        if (typeof options === 'function') {
            callback = options as any;
            options = {};
        }

        try {
            switch (options?.family) {

                case 4: {
                    if (!v4Hosts.has(hostname)) {
                        const results = await resolver.resolve4(hostname, { ttl: true });

                        const ttl = _.min(_.map(results, 'ttl')) || 5;
                        const addresses = _.map(results, 'address');

                        v4Hosts.set(hostname, addresses);

                        setTimeout(() => {
                            v4Hosts.delete(hostname);
                        }, ttl * 1000).unref();

                        if (options?.all) {
                            return callback(null, addresses.map((x) => {
                                return { address: x, family: 4 };
                            }));
                        }

                        return callback(null, addresses[0], 4);
                    }

                    const addresses = v4Hosts.get(hostname)!;
                    if (options.all) {
                        return callback(null, addresses.map((x) => {
                            return { address: x, family: 4 };
                        }));
                    }

                    return callback(null, addresses[0], 4);

                    break;
                }

                case 6: {

                    if (!v6Hosts.has(hostname)) {
                        const results = await resolver.resolve6(hostname, { ttl: true });

                        const ttl = _.min(_.map(results, 'ttl')) || 5;
                        const addresses = _.map(results, 'address');

                        v6Hosts.set(hostname, addresses);

                        setTimeout(() => {
                            v6Hosts.delete(hostname);
                        }, ttl * 1000).unref();

                        if (options?.all) {
                            return callback(null, addresses.map((x) => {
                                return { address: x, family: 6 };
                            }));
                        }

                        return callback(null, addresses[0], 6);

                    }

                    const addresses = v6Hosts.get(hostname)!;
                    if (options.all) {
                        return callback(null, addresses.map((x) => {
                            return { address: x, family: 6 };
                        }));
                    }

                    return callback(null, addresses[0], 6);

                    break;
                }

                case 0:
                default: {
                    let addresses: any[] = [];

                    const v4Addresses = v4Hosts.get(hostname)!;
                    const v6Addresses = v6Hosts.get(hostname)!;

                    if (v4Addresses || v6Addresses) {
                        if (v4Addresses) {
                            addresses.push(...v4Addresses.map((x) => { return { address: x, family: 4 }; }));
                        }
                        if (v6Addresses) {
                            addresses.push(...v6Addresses.map((x) => { return { address: x, family: 6 }; }));
                        }

                        if (options?.all) {
                            return callback(null, addresses);
                        }

                        return callback(null, addresses[0].address, addresses[0].family);
                    }

                    const rp4 = resolver.resolve4(hostname, { ttl: true }).then((r) => { addresses.push(...r.map((x) => ({ address: x, family: 4 }))); return r; });
                    const rp6 = resolver.resolve6(hostname, { ttl: true }).then((r) => { addresses.push(...r.map((x) => ({ address: x, family: 6 }))); return r; });

                    const [results4, results6] = await Promise.allSettled([rp4, rp6]);

                    if (!(results4.status === 'fulfilled' && results6.status === 'fulfilled')) {
                        return callback((results4 as PromiseRejectedResult).reason);
                    }

                    if (results4.status === 'fulfilled') {
                        const ttl4 = _.min(_.map(results4.value, 'ttl')) || 5;
                        const addresses4 = _.map(results4.value, 'address');

                        v4Hosts.set(hostname, addresses4);

                        setTimeout(() => {
                            v4Hosts.delete(hostname);
                        }, ttl4 * 1000).unref();
                    }

                    if (results6.status === 'fulfilled') {
                        const ttl6 = _.min(_.map(results6.value, 'ttl')) || 5;
                        const addresses6 = _.map(results6.value, 'address');

                        v6Hosts.set(hostname, addresses6);

                        setTimeout(() => {
                            v6Hosts.delete(hostname);
                        }, ttl6 * 1000).unref();
                    }

                    if (options?.verbatim === false) {
                        addresses = _.sortBy(addresses, 'family');
                    }

                    if (options?.all) {
                        return callback(null, addresses);
                    }

                    return callback(null, addresses[0].address, addresses[0].family);


                    break;
                }
            }
        } catch (err: any) {
            return callback(err);
        }
    }

    return lookup;
}
