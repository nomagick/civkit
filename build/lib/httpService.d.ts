/// <reference types="node" />
import { Agent as HTTPAgent } from 'http';
import { Agent as HTTPSAgent } from 'https';
import { URL } from 'url';
import { Cookie, CookieJar, MemoryCookieStore } from 'tough-cookie';
import FormData from 'form-data';
import { EventEmitter } from 'events';
import { RequestInit, Response } from 'node-fetch';
export { FetchError } from 'node-fetch';
export declare function timeout<T>(promise: Promise<T>, ttl: number): Promise<T>;
export declare type SimpleCookie = Cookie.Properties[] | {
    [key: string]: string;
} | string[];
export declare type PromiseWithCancel<T> = Promise<T> & {
    cancel: () => void;
};
export declare class InertMemoryCookieStore extends MemoryCookieStore {
    protected _muted: boolean;
    protected _locked: boolean;
    protected __lockedError: Error;
    lock(): this;
    unlock(): this;
    mute(): this;
    unmute(): this;
    removeCookie(domain: string, path: string, key: string, cb: (err: Error | null) => void): void;
    removeCookies(domain: string, path: string, cb: (err: Error | null) => void): void;
    updateCookie(oldCookie: Cookie, newCookie: Cookie, cb: (err: Error | null) => void): void;
    putCookie(cookie: Cookie, cb: (err: Error | null) => void): void;
}
export declare function parseSimpleCookie(sc: SimpleCookie): Cookie[];
export declare type HTTPServiceOptions = RequestInit & {
    cookie?: SimpleCookie;
    jar?: CookieJar;
    raw?: boolean;
    responseType?: 'json' | 'stream' | 'text';
};
export interface HTTPServiceConfig {
    agent?: HTTPAgent | HTTPSAgent;
    requestOptions?: HTTPServiceOptions;
    protocol?: 'http' | 'https';
    hostName?: string;
    port?: number;
    baseUri?: string;
    baseParams?: {
        [k: string]: string | string[];
    };
    baseHeaders?: {
        [k: string]: string | string[];
    };
    initialCookies?: SimpleCookie;
}
export declare class HTTPServiceError extends Error {
    err: any;
    response?: Response;
    constructor(err: any, response?: Response);
}
export declare abstract class HTTPService extends EventEmitter {
    config: HTTPServiceConfig;
    protected baseUrl: string;
    baseURL: URL;
    baseOptions: HTTPServiceOptions;
    httpAgent: HTTPAgent;
    httpsAgent: HTTPSAgent;
    baseParams: {
        [k: string]: string | string[];
    };
    baseHeaders: {
        [k: string]: string | string[];
    };
    cookieJar: CookieJar & {
        unlock: () => InertMemoryCookieStore;
        lock: () => InertMemoryCookieStore;
    };
    counter: number;
    Error: typeof HTTPServiceError;
    constructor(baseUrl: string, config?: HTTPServiceConfig);
    dumpCookieJar(): CookieJar.Serialized;
    breakAndReplaceCookieJar(source?: any): void;
    get poolSize(): number;
    set poolSize(size: number);
    urlOf(pathName: string, queryParams?: any): string;
    __composeOption(...options: Array<HTTPServiceOptions | undefined>): HTTPServiceOptions;
    __request<T = any>(method: string, uri: string, queryParams?: any, _options?: HTTPServiceOptions, ..._moreOptions: Array<HTTPServiceOptions | undefined>): PromiseWithCancel<Response & {
        data: T;
    }>;
    __processResponse(options: HTTPServiceOptions, r: Response): Promise<any>;
    get<T = any>(uri: string, queryParams?: any, options?: HTTPServiceOptions): PromiseWithCancel<Response & {
        data: T;
    }>;
    postForm<T = any>(uri: string, queryParams?: any, data?: any, options?: HTTPServiceOptions): PromiseWithCancel<Response & {
        data: T;
    }>;
    postMultipart<T = any>(uri: string, queryParams?: any, multipart?: Array<[string, any, FormData.AppendOptions?]>, options?: HTTPServiceOptions): PromiseWithCancel<Response & {
        data: T;
    }>;
    postJson<T = any>(uri: string, queryParams?: any, data?: any, options?: HTTPServiceOptions): PromiseWithCancel<Response & {
        data: T;
    }>;
    delete<T = any>(uri: string, queryParams?: any, options?: HTTPServiceOptions): PromiseWithCancel<Response & {
        data: T;
    }>;
}
export declare type HTTPServiceResponse<T> = Response & {
    data: T;
};
//# sourceMappingURL=httpService.d.ts.map