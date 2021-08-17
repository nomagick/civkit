"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeCustomDNSResolveFunc = void 0;
const tslib_1 = require("tslib");
const dns_1 = require("dns");
const lodash_1 = tslib_1.__importDefault(require("lodash"));
const net_1 = require("net");
function makeCustomDNSResolveFunc(options) {
    const resolver = new dns_1.promises.Resolver({ timeout: options.timeout });
    if (options.servers) {
        resolver.setServers(options.servers);
    }
    const v4Hosts = new Map();
    const v6Hosts = new Map();
    if (options.hosts) {
        for (const [k, v] of Object.entries(options.hosts)) {
            if (Array.isArray(v)) {
                for (const x of v) {
                    if (net_1.isIPv4(x)) {
                        const s = v4Hosts.get(k);
                        if (s) {
                            s.push(x);
                        }
                        else {
                            v4Hosts.set(k, [x]);
                        }
                    }
                    else if (net_1.isIPv6(x)) {
                        const s = v4Hosts.get(k);
                        if (s) {
                            s.push(x);
                        }
                        else {
                            v6Hosts.set(k, [x]);
                        }
                    }
                }
                continue;
            }
            if (net_1.isIPv4(v)) {
                v4Hosts.set(k, [v]);
            }
            else if (net_1.isIPv6(v)) {
                v6Hosts.set(k, [v]);
            }
        }
    }
    async function lookup(hostname, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        try {
            switch (options?.family) {
                case 4: {
                    if (!v4Hosts.has(hostname)) {
                        const results = await resolver.resolve4(hostname, { ttl: true });
                        const ttl = lodash_1.default.min(lodash_1.default.map(results, 'ttl')) || 5;
                        const addresses = lodash_1.default.map(results, 'address');
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
                    const addresses = v4Hosts.get(hostname);
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
                        const ttl = lodash_1.default.min(lodash_1.default.map(results, 'ttl')) || 5;
                        const addresses = lodash_1.default.map(results, 'address');
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
                    const addresses = v6Hosts.get(hostname);
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
                    let addresses = [];
                    const v4Addresses = v4Hosts.get(hostname);
                    const v6Addresses = v6Hosts.get(hostname);
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
                        return callback(results4.reason);
                    }
                    if (results4.status === 'fulfilled') {
                        const ttl4 = lodash_1.default.min(lodash_1.default.map(results4.value, 'ttl')) || 5;
                        const addresses4 = lodash_1.default.map(results4.value, 'address');
                        v4Hosts.set(hostname, addresses4);
                        setTimeout(() => {
                            v4Hosts.delete(hostname);
                        }, ttl4 * 1000).unref();
                    }
                    if (results6.status === 'fulfilled') {
                        const ttl6 = lodash_1.default.min(lodash_1.default.map(results6.value, 'ttl')) || 5;
                        const addresses6 = lodash_1.default.map(results6.value, 'address');
                        v6Hosts.set(hostname, addresses6);
                        setTimeout(() => {
                            v6Hosts.delete(hostname);
                        }, ttl6 * 1000).unref();
                    }
                    if (options?.verbatim === false) {
                        addresses = lodash_1.default.sortBy(addresses, 'family');
                    }
                    if (options?.all) {
                        return callback(null, addresses);
                    }
                    return callback(null, addresses[0].address, addresses[0].family);
                    break;
                }
            }
        }
        catch (err) {
            return callback(err);
        }
    }
    return lookup;
}
exports.makeCustomDNSResolveFunc = makeCustomDNSResolveFunc;
//# sourceMappingURL=custom-lookup.js.map