"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HTTPService = exports.HTTPServiceError = exports.parseSimpleCookie = exports.InertMemoryCookieStore = exports.timeout = exports.FetchError = void 0;
const tslib_1 = require("tslib");
const http_1 = require("http");
const https_1 = require("https");
const url_1 = require("url");
const tough_cookie_1 = require("tough-cookie");
const form_data_1 = tslib_1.__importDefault(require("form-data"));
const lodash_1 = tslib_1.__importDefault(require("lodash"));
const events_1 = require("events");
const querystring_1 = require("querystring");
const defer_1 = require("./defer");
const node_fetch_1 = tslib_1.__importDefault(require("node-fetch"));
const abort_controller_1 = tslib_1.__importDefault(require("abort-controller"));
var node_fetch_2 = require("node-fetch");
Object.defineProperty(exports, "FetchError", { enumerable: true, get: function () { return node_fetch_2.FetchError; } });
function timeout(promise, ttl) {
    const deferred = defer_1.Defer();
    promise.then(deferred.resolve, deferred.reject);
    setTimeout(() => {
        promise.catch(() => 0);
        deferred.reject(new defer_1.TimeoutError(`Operation timedout after ${ttl}ms.`));
        if (typeof promise.cancel === 'function') {
            promise.cancel();
        }
    }, ttl);
    return deferred.promise;
}
exports.timeout = timeout;
class InertMemoryCookieStore extends tough_cookie_1.MemoryCookieStore {
    constructor() {
        super(...arguments);
        this._muted = false;
        this._locked = false;
        this.__lockedError = new Error('Operation Refused: Inert cookie is in locked state.');
    }
    lock() {
        this._locked = true;
        return this;
    }
    unlock() {
        this._locked = false;
        return this;
    }
    mute() {
        this._muted = true;
        return this;
    }
    unmute() {
        this._muted = false;
        return this;
    }
    removeCookie(domain, path, key, cb) {
        if (this._locked) {
            this._muted ? cb(null) : cb(this.__lockedError);
            return;
        }
        return super.removeCookie(domain, path, key, cb);
    }
    removeCookies(domain, path, cb) {
        if (this._locked) {
            this._muted ? cb(null) : cb(this.__lockedError);
            return;
        }
        return super.removeCookies(domain, path, cb);
    }
    updateCookie(oldCookie, newCookie, cb) {
        if (this._locked) {
            this._muted ? cb(null) : cb(this.__lockedError);
            return;
        }
        return super.updateCookie(oldCookie, newCookie, cb);
    }
    putCookie(cookie, cb) {
        if (this._locked) {
            this._muted ? cb(null) : cb(this.__lockedError);
            return;
        }
        return super.putCookie(cookie, cb);
    }
}
exports.InertMemoryCookieStore = InertMemoryCookieStore;
function parseSimpleCookie(sc) {
    const cookies = [];
    if (Array.isArray(sc)) {
        for (const c of sc) {
            let cookie;
            if (typeof c === 'string') {
                cookie = tough_cookie_1.Cookie.parse(c);
            }
            else if (c instanceof Object) {
                cookie = new tough_cookie_1.Cookie(c);
            }
            if (cookie) {
                cookies.push(cookie);
            }
        }
    }
    else if (sc instanceof Object) {
        for (const [k, v] of Object.entries(sc)) {
            cookies.push(new tough_cookie_1.Cookie({ key: k, value: v }));
        }
    }
    else {
        throw new Error('Invlid Simple Cookie.');
    }
    return cookies;
}
exports.parseSimpleCookie = parseSimpleCookie;
function getAgent(protocol) {
    return protocol === 'http' ? new http_1.Agent({
        keepAlive: true,
        keepAliveMsecs: 20 * 1000,
        maxSockets: 100,
        maxFreeSockets: 5
    }) : new https_1.Agent({
        keepAlive: true,
        keepAliveMsecs: 20 * 1000,
        maxSockets: 100,
        maxFreeSockets: 5
    });
}
class HTTPServiceError extends Error {
    constructor(err, response) {
        super(err);
        this.err = err;
        this.response = response;
    }
}
exports.HTTPServiceError = HTTPServiceError;
function patchCookieJar(jar, store) {
    jar.lock = store.lock.bind(store);
    jar.unlock = store.unlock.bind(store);
}
class HTTPService extends events_1.EventEmitter {
    constructor(baseUrl, config = {}) {
        super();
        this.counter = 0;
        this.Error = HTTPServiceError;
        this.httpAgent = getAgent('http');
        this.httpsAgent = getAgent('https');
        this.config = lodash_1.default.defaults(config, {
            requestOptions: {},
            baseParams: {},
            baseHeaders: {},
            initialCookies: {}
        });
        this.baseUrl = baseUrl;
        this.baseURL = new url_1.URL(baseUrl);
        const inertStore = new InertMemoryCookieStore();
        const newJar = new tough_cookie_1.CookieJar(inertStore);
        patchCookieJar(newJar, inertStore);
        this.cookieJar = newJar;
        this.cookieJar.unlock().mute();
        for (const x of parseSimpleCookie(this.config.initialCookies)) {
            this.cookieJar.setCookie(x, this.baseUrl).catch();
        }
        this.cookieJar.lock();
        this.baseOptions = lodash_1.default.defaultsDeep(config.requestOptions, {
            maxRedirects: 0, timeout: 5000
        });
        this.baseParams = this.config.baseParams;
        this.baseHeaders = this.config.baseHeaders;
        this.baseOptions.jar = this.cookieJar;
        this.on('response', (resp) => {
            const setCookieHeader = resp.headers.get('Set-Cookie');
            const serial = arguments[arguments.length - 1];
            if (Array.isArray(setCookieHeader)) {
                for (const x of setCookieHeader) {
                    this.emit('set-cookie', x, serial);
                }
            }
            else if (setCookieHeader) {
                this.emit('set-cookie', setCookieHeader, serial);
            }
        });
    }
    dumpCookieJar() {
        return this.cookieJar.serializeSync();
    }
    breakAndReplaceCookieJar(source) {
        const inertStore = new InertMemoryCookieStore();
        const newJar = source ? tough_cookie_1.CookieJar.deserializeSync(source, inertStore) : new tough_cookie_1.CookieJar(inertStore, { looseMode: true });
        patchCookieJar(newJar, inertStore);
        this.cookieJar = newJar;
    }
    get poolSize() {
        return (this.baseUrl.startsWith('https') ? this.httpsAgent : this.httpAgent).maxSockets;
    }
    set poolSize(size) {
        (this.baseUrl.startsWith('https') ? this.httpsAgent : this.httpAgent).maxSockets = size;
    }
    urlOf(pathName, queryParams = {}) {
        const params = new url_1.URLSearchParams(this.baseParams);
        for (const [k, v] of Object.entries(queryParams || {})) {
            if (Array.isArray(v)) {
                if (v.length) {
                    for (const y of v) {
                        params.append(k, y);
                    }
                }
                else {
                    params.append(k, '');
                }
            }
            else {
                params.set(k, (v === undefined || v === null || (typeof v === 'number' && isNaN(v))) ? '' : v);
            }
        }
        const pString = params.toString();
        const url = new url_1.URL(pString ? `${pathName}?${pString}` : pathName, this.baseUrl);
        url.pathname = `${this.baseURL.pathname}${url.pathname}`.replace(/^\/+/, '/');
        return url.toString();
    }
    __composeOption(...options) {
        const finalOptons = lodash_1.default.merge({}, this.baseOptions, ...options);
        return finalOptons;
    }
    __request(method, uri, queryParams, _options, ..._moreOptions) {
        const abortCtrl = new abort_controller_1.default();
        const url = this.urlOf(uri, queryParams);
        const options = this.__composeOption({
            method: method,
            signal: abortCtrl.signal
        }, _options, ..._moreOptions);
        const deferred = defer_1.Defer();
        deferred.promise.cancel = abortCtrl.abort;
        node_fetch_1.default(url, options)
            .then(async (r) => {
            try {
                const parsed = await this.__processResponse(options, r);
                Object.defineProperties(r, {
                    data: { value: parsed },
                    config: { value: { ...options, url } }
                });
                deferred.resolve(r);
                return;
            }
            catch (err) {
                Object.defineProperties(r, {
                    config: { value: { ...options, url } },
                    data: { value: err }
                });
                deferred.reject(r);
            }
        }, (err) => {
            Object.defineProperties(err, {
                config: { value: { ...options, url } },
                status: { value: err.code || err.errno }
            });
            deferred.reject(err);
        }).catch(deferred.reject);
        return deferred.promise;
    }
    async __processResponse(options, r) {
        const contentType = r.headers.get('Content-Type');
        let bodyParsed = null;
        do {
            if (options.raw) {
                break;
            }
            if (options.responseType === 'json') {
                bodyParsed = await r.json();
                break;
            }
            else if (options.responseType === 'stream') {
                bodyParsed = r.body;
                break;
            }
            else if (options.responseType === 'text') {
                bodyParsed = await r.textConverted();
                break;
            }
            if (contentType?.startsWith('application/json')) {
                bodyParsed = await r.json();
            }
            else if (contentType?.startsWith('text/')) {
                bodyParsed = await r.textConverted();
            }
            break;
        } while (false);
        if (r.ok) {
            return bodyParsed === null ? r : bodyParsed;
        }
        throw bodyParsed === null ? r : bodyParsed;
    }
    get(uri, queryParams, options) {
        return this.__request('GET', uri, queryParams, options);
    }
    postForm(uri, queryParams = {}, data = {}, options) {
        return this.__request('POST', uri, queryParams, {
            body: querystring_1.stringify(data),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }, options);
    }
    postMultipart(uri, queryParams = {}, multipart = [], options) {
        const form = new form_data_1.default();
        for (const [k, v, o] of multipart) {
            form.append(k, v, o);
        }
        return this.__request('POST', uri, queryParams, { body: form, headers: { ...form.getHeaders() } }, options);
    }
    postJson(uri, queryParams, data, options) {
        return this.__request('POST', uri, queryParams, { body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }, options);
    }
    delete(uri, queryParams, options) {
        return this.__request('DELETE', uri, queryParams, options);
    }
}
exports.HTTPService = HTTPService;
//# sourceMappingURL=httpService.js.map