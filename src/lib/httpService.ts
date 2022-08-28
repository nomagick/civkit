// tslint:disable: no-magic-numbers
import { Agent as HTTPAgent } from 'http';
import { Agent as HTTPSAgent } from 'https';

import { URL, URLSearchParams } from 'url';

import { Cookie, CookieJar, MemoryCookieStore } from 'tough-cookie';

import FormData from 'form-data';

import _ from 'lodash';
import { EventEmitter } from 'events';
import { stringify as formDataStringify } from 'querystring';
import { Defer, TimeoutError } from './defer';
import fetch, { RequestInit, Response, FetchError, Headers } from 'node-fetch';
import AbortController from "abort-controller";

export { FetchError, Request, Response, Headers, RequestInit } from 'node-fetch';

import { stringifyErrorLike } from '../utils/lang';

export function timeout<T>(promise: Promise<T>, ttl: number): Promise<T> {

    const deferred = Defer();
    promise.then(deferred.resolve, deferred.reject);

    setTimeout(() => {
        promise.catch(() => 0);
        deferred.reject(new TimeoutError(`Operation timedout after ${ttl}ms.`));
        if (typeof (promise as any).cancel === 'function') {
            (promise as any).cancel();
        }
    }, ttl);

    return deferred.promise;
}


export type PromiseWithCancel<T> = Promise<T> & { cancel: () => void };


export interface HTTPServiceRequestOptions extends RequestInit {
    url?: string;
    raw?: boolean;
    responseType?: 'json' | 'stream' | 'text' | 'buffer';
}

function getAgent(protocol: 'https'): HTTPSAgent;
function getAgent(protocol: 'http'): HTTPAgent;
function getAgent(protocol: 'http' | 'https') {
    return protocol === 'http' ? new HTTPAgent({
        keepAlive: true,

        keepAliveMsecs: 20 * 1000,
        maxSockets: 100,
        maxFreeSockets: 5
    }) : new HTTPSAgent({
        keepAlive: true,
        keepAliveMsecs: 20 * 1000,
        maxSockets: 100,
        maxFreeSockets: 5
    });
}

export interface HTTPServiceConfig {
    agent?: HTTPAgent | HTTPSAgent;
    requestOptions?: HTTPServiceRequestOptions;

    protocol?: 'http' | 'https';
    hostName?: string;
    port?: number;
    baseUri?: string;

    baseParams?: { [k: string]: string | string[]; };
    baseHeaders?: { [k: string]: string | string[]; };
    initialCookies?: SimpleCookie;
}

export class HTTPServiceError<T extends HTTPServiceRequestOptions = HTTPServiceRequestOptions> extends Error {
    err?: Error | FetchError | { [k: string]: any; } | null;
    serial: number;
    status?: string | number;
    config?: T;
    response?: Response;
    constructor(serial: number, options?: {
        err?: Error | FetchError;
        status?: string | number;
        config?: T;
        response?: Response;
    }) {
        super(`Req(${serial}): ${options?.err?.message}`);
        this.serial = serial;
        if (options) {
            Object.assign(this, options);
        }
        this.message = `Req(${serial} ${this.response?.status || '???'} ${(this.config?.method || 'get').toUpperCase()} ${this.config?.url}): ${stringifyErrorLike(this.err)}`;
        if (this.response?.status !== undefined) {
            this.status = this.response.status;
        }
        if (this.err?.stack && this.stack) {
            const message_lines = (this.message.match(/\n/g) || []).length + 1;
            this.stack = this.stack.split('\n').slice(0, message_lines + 1).join('\n') +
                '\n\nWhich was derived from:\n\n' +
                this.err.stack;
        }
    }
}

type FetchPatch<To> = {
    serial: number;
    config: To;
};

export abstract class HTTPService<
    Tc extends HTTPServiceConfig = HTTPServiceConfig,
    To extends HTTPServiceRequestOptions = HTTPServiceRequestOptions
    > extends EventEmitter {
    config: Tc;

    protected baseUrl: string;
    baseURL: URL;
    baseOptions: To;

    httpAgent: HTTPAgent;
    httpsAgent: HTTPSAgent;

    baseParams: { [k: string]: string | string[]; };
    baseHeaders: { [k: string]: string | string[]; };

    counter: number = 0;

    // tslint:disable-next-line:variable-name
    Error: typeof HTTPServiceError = HTTPServiceError;

    constructor(baseUrl: string, config: Tc = {} as any) {
        super();
        this.httpAgent = getAgent('http');
        this.httpsAgent = getAgent('https');
        this.config = _.defaults(config, {
            requestOptions: {},
            baseParams: {},
            baseHeaders: {},
            initialCookies: {},
        });

        this.baseUrl = baseUrl;
        this.baseURL = new URL(baseUrl);

        this.baseOptions = _.defaultsDeep(config.requestOptions, {
            maxRedirects: 0,
            timeout: 1000 * 60 * 0.5,
        });

        this.baseParams = this.config.baseParams!;
        this.baseHeaders = this.config.baseHeaders!;
    }

    get poolSize() {
        return (this.baseUrl.startsWith('https') ? this.httpsAgent : this.httpAgent).maxSockets;
    }

    set poolSize(size: number) {
        (this.baseUrl.startsWith('https') ? this.httpsAgent : this.httpAgent).maxSockets = size;
    }

    urlOf(pathName: string, queryParams: any = {}) {
        const params = new URLSearchParams(this.baseParams as any);
        for (const [k, v] of Object.entries<any>(queryParams || {})) {
            if (Array.isArray(v)) {
                if (v.length) {
                    for (const y of v) {
                        params.append(k, y);
                    }
                } else {
                    params.append(k, '');
                }
            } else {
                params.set(k, v === undefined || v === null || (typeof v === 'number' && isNaN(v)) ? '' : v);
            }
        }

        const pString = params.toString();
        const url = new URL(pString ? `${pathName}?${pString}` : pathName, this.baseUrl);

        if (url.origin === this.baseURL.origin) {
            url.pathname = `${this.baseURL.pathname}${url.pathname}`.replace(/^\/+/, '/');
        }

        return url.toString();
    }

    __composeOption(...options: Array<To | undefined>): To {
        const finalOptions: any = _.merge({}, this.baseOptions, { headers: this.baseHeaders }, ...options);

        return finalOptions;
    }

    __request<T = any>(
        method: string,
        uri: string,
        queryParams?: any,
        _options?: To,
        ..._moreOptions: Array<To | undefined>
    ): PromiseWithCancel<Response & { data: T; } & FetchPatch<To>> {
        const abortCtrl = new AbortController();
        const url = this.urlOf(uri, queryParams);
        const options = this.__composeOption(
            {
                method: method as any,
                signal: abortCtrl.signal,
            } as any,
            _options,
            ..._moreOptions
        );

        if (options.responseType) {
            const headers = new Headers(options.headers);
            options.headers = headers;

            if (!headers.has('Accept')) {
                switch (options.responseType) {
                    case 'json': {
                        headers.set('Accept', 'application/json');
                        break;
                    }

                    case 'text':
                    case 'stream':
                    case 'buffer':
                    default: {
                        headers.set('Accept', '*/*');
                        break;
                    }
                }
            }
        }

        const deferred = Defer();
        (deferred.promise as any).cancel = abortCtrl.abort.bind(abortCtrl);
        const serial = this.counter++;
        const config = { ...options, url };
        this.emit('request', config, serial);
        fetch(url, options).then(
            async (r) => {
                Object.defineProperties(r, {
                    serial: { value: serial },
                    config: { value: config },
                });
                this.emit('response', r, serial);
                try {
                    const parsed = await this.__processResponse(options, r);
                    Object.defineProperties(r, {
                        data: { value: parsed, writable: true },
                    });

                    this.emit('parsed', parsed, r, serial);

                    deferred.resolve(r);

                    return;
                } catch (err: any) {
                    const newErr = new this.Error(serial, {
                        err,
                        config,
                        response: r,
                        status: r.status || err.code || err.errno
                    });

                    this.emit('exception', newErr, r, serial);

                    deferred.reject(newErr);
                }
            },
            (err: any) => {
                const newErr = new this.Error(serial, {
                    err,
                    config,
                    status: err.code || err.errno
                });

                this.emit('exception', newErr, undefined, serial);
                deferred.reject(newErr);
            }
        );

        return deferred.promise as any;
    }


    async __processResponse(options: HTTPServiceRequestOptions, r: Response) {
        const contentType = r.headers.get('Content-Type');
        let bodyParsed: any = null;
        do {
            if (options.raw) {
                break;
            }
            if (options.responseType === 'json') {
                bodyParsed = await r.json();
                break;
            } else if (options.responseType === 'text') {
                bodyParsed = await r.text();
                break;
            } else if (options.responseType === 'buffer') {
                bodyParsed = r.buffer();
                break;
            } else if (options.responseType === 'stream') {
                bodyParsed = r.body;
                break;
            }
            if (contentType?.startsWith('application/json')) {
                bodyParsed = await r.json();
            } else if (contentType?.startsWith('text/')) {
                bodyParsed = await r.text();
            }
            break;
            // eslint-disable-next-line no-constant-condition
        } while (false);

        if (r.ok) {
            return bodyParsed === null ? r : bodyParsed;
        }

        throw bodyParsed === null ? r : bodyParsed;
    }

    getWithSearchParams<T = any>(uri: string, searchParams?: any, options?: To) {
        return this.__request<T>('GET', uri, searchParams, options);
    }
    get<T = any>(uri: string, options?: To) {
        return this.getWithSearchParams<T>(uri, undefined, options);
    }

    postFormWithSearchParams<T = any>(uri: string, searchParams: any = {}, data: any = {}, options?: To) {
        return this.__request<T>(
            'POST',
            uri,
            searchParams,
            {
                body: formDataStringify(data),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            } as any,
            options
        );
    }

    postForm<T = any>(uri: string, data: any = {}, options?: To) {
        return this.postFormWithSearchParams<T>(uri, undefined, data, options);
    }

    postMultipartWithSearchParams<T = any>(
        uri: string,
        searchParams: any = {},
        multipart: Array<[string, any, FormData.AppendOptions?]> = [],
        options?: To
    ) {
        const form = new FormData();

        for (const [k, v, o] of multipart) {
            form.append(k, v, o);
        }

        return this.__request<T>(
            'POST',
            uri,
            searchParams,
            { body: form, headers: { ...form.getHeaders() } } as any,
            options
        );
    }
    postMultipart<T = any>(
        uri: string,
        multipart: Array<[string, any, FormData.AppendOptions?]> = [],
        options?: To
    ) {
        return this.postMultipartWithSearchParams<T>(uri, undefined, multipart, options);
    }

    postJsonWithSearchParams<T = any>(uri: string, searchParams?: any, data?: any, options?: To) {
        return this.__request<T>(
            'POST',
            uri,
            searchParams,
            {
                body: JSON.stringify(data),
                headers: { 'Content-Type': 'application/json' },
            } as any,
            options
        );
    }

    postJson<T = any>(uri: string, data?: any, options?: To) {
        return this.postJsonWithSearchParams<T>(uri, undefined, data, options);
    }

    deleteWithSearchParams<T = any>(uri: string, searchParams?: any, options?: To) {
        return this.__request<T>('DELETE', uri, searchParams, options);
    }
    delete<T = any>(uri: string, options?: To) {
        return this.deleteWithSearchParams<T>(uri, undefined, options);
    }
}
// eslint-disable max-len
export interface HTTPService {
    on(name: 'request', listener: (config: HTTPServiceRequestOptions, serial: number) => void): this;

    on(
        name: 'response',
        listener: (response: Response & FetchPatch<HTTPServiceRequestOptions>, serial: number) => void
    ): this;
    on(
        name: 'exception',
        listener: (
            error: HTTPServiceError,
            response: (Response & FetchPatch<HTTPServiceRequestOptions>) | undefined,
            serial: number
        ) => void
    ): this;
    on(
        name: 'parsed',
        listener: (
            parsed: any,
            response: Response & FetchPatch<HTTPServiceRequestOptions> & { data: any; },
            serial: number
        ) => void
    ): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
}

export type SimpleCookie = Cookie.Properties[] | { [key: string]: string } | string[];
export class InertMemoryCookieStore extends MemoryCookieStore {
    protected _muted: boolean = false;
    protected _locked: boolean = false;
    // tslint:disable-next-line: variable-name
    protected __lockedError = new Error('Operation Refused: Inert cookie is in locked state.');

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

    removeCookie(domain: string, path: string, key: string, cb: (err: Error | null) => void) {
        if (this._locked) {
            this._muted ? cb(null) : cb(this.__lockedError);

            return;
        }

        return super.removeCookie(domain, path, key, cb);
    }
    removeCookies(domain: string, path: string, cb: (err: Error | null) => void) {
        if (this._locked) {
            this._muted ? cb(null) : cb(this.__lockedError);

            return;
        }

        return super.removeCookies(domain, path, cb);
    }

    updateCookie(oldCookie: Cookie, newCookie: Cookie, cb: (err: Error | null) => void) {
        if (this._locked) {
            this._muted ? cb(null) : cb(this.__lockedError);

            return;
        }

        return super.updateCookie(oldCookie, newCookie, cb);
    }

    putCookie(cookie: Cookie, cb: (err: Error | null) => void) {
        if (this._locked) {
            this._muted ? cb(null) : cb(this.__lockedError);

            return;
        }

        return super.putCookie(cookie, cb);
    }
}


function patchCookieJar(jar: CookieJar, store: InertMemoryCookieStore) {
    (jar as any).lock = store.lock.bind(store);
    (jar as any).unlock = store.unlock.bind(store);
}

export function parseSimpleCookie(sc: SimpleCookie): Cookie[] {
    const cookies: Cookie[] = [];
    if (Array.isArray(sc)) {
        for (const c of sc) {
            let cookie;
            if (typeof c === 'string') {
                cookie = Cookie.parse(c);
            } else if (c instanceof Object) {
                cookie = new Cookie(c);
            }
            if (cookie) {
                cookies.push(cookie);
            }
        }
    } else if (sc instanceof Object) {
        for (const [k, v] of Object.entries(sc)) {
            cookies.push(new Cookie({ key: k, value: v }));
        }
    } else {
        throw new Error('Invlid Simple Cookie.');
    }

    return cookies;
}

export interface CookieAwareHTTPServiceRequestOptions extends HTTPServiceRequestOptions {
    cookie?: SimpleCookie;
    jar?: CookieJar;
}

export interface CookieAwareHTTPServiceConfig extends HTTPServiceConfig {
    initialCookies?: SimpleCookie;
    lockCookiesAfterInit?: boolean;
}

export abstract class CookieAwareHTTPService extends HTTPService<CookieAwareHTTPServiceConfig, CookieAwareHTTPServiceRequestOptions> {
    cookieJar: CookieJar & {
        unlock: () => InertMemoryCookieStore; lock: () => InertMemoryCookieStore;
    };

    constructor(baseUrl: string, config: CookieAwareHTTPServiceConfig = {}) {
        super(baseUrl, config);

        const inertStore = new InertMemoryCookieStore();
        const newJar = new CookieJar(inertStore);
        patchCookieJar(newJar, inertStore);
        this.cookieJar = newJar as any;

        this.cookieJar.unlock().mute();
        for (const x of parseSimpleCookie(this.config.initialCookies!)) {
            this.cookieJar.setCookie(x, this.baseUrl).catch();
        }

        if (this.config.lockCookiesAfterInit) {
            this.cookieJar.lock();
        }

        this.baseOptions.jar = this.cookieJar;

        this.on('response', (resp, serial) => {
            const setCookieHeader = resp.headers.raw()['set-cookie'];
            if (Array.isArray(setCookieHeader)) {
                for (const x of setCookieHeader) {
                    this.emit('set-cookie', x, resp, serial);
                }
            } else if (setCookieHeader) {
                this.emit('set-cookie', setCookieHeader, resp, serial);
            }
        });
    }

    dumpCookieJar() {
        return this.cookieJar.serializeSync();
    }

    breakAndReplaceCookieJar(source?: any) {
        const inertStore = new InertMemoryCookieStore();
        const newJar = source ? CookieJar.deserializeSync(source, inertStore) : new CookieJar(inertStore, { looseMode: true });
        patchCookieJar(newJar, inertStore);
        this.cookieJar = newJar as any;
    }
}

export interface CookieAwareHTTPService {

    on(name: 'request', listener: (config: CookieAwareHTTPServiceRequestOptions, serial: number) => void): this;
    on(name: 'response', listener: (response: Response & FetchPatch<CookieAwareHTTPServiceRequestOptions>, serial: number) => void): this;
    on(name: 'exception', listener: (error: HTTPServiceError, response: Response & FetchPatch<CookieAwareHTTPServiceRequestOptions> | undefined, serial: number) => void): this;
    on(name: 'parsed', listener: (parsed: any, response: Response & FetchPatch<CookieAwareHTTPServiceRequestOptions> & { data: any }, serial: number) => void): this;

    on(name: 'set-cookie', listener: (headerContent: string, response: Response & FetchPatch<CookieAwareHTTPServiceRequestOptions>, serial: number) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;

}

export type HTTPServiceResponse<T> = Response & { data: T; };
