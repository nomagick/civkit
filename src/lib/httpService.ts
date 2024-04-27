import { URL, URLSearchParams } from 'url';

import _ from 'lodash';
import { EventEmitter } from 'events';
import { stringify as formDataStringify } from 'querystring';

import { Defer } from './defer';
import { patchErrorCaptureStackTraceIfNeeded, stringifyErrorLike } from '../utils/lang';

import { Readable, isReadable } from 'stream';
import { ReadableStream } from 'stream/web';

export type PromiseWithCancel<T> = Promise<T> & { cancel: (reason?: any) => void; };
export type ReadableWithCancel = Readable & { cancel: (reason?: any) => void; };

export interface HTTPServiceRequestOptions extends RequestInit {
    url?: string;
    raw?: boolean;
    responseType?: 'json' | 'stream' | 'text' | 'buffer' | 'blob';
    timeout?: number;
}

export interface HTTPServiceConfig {
    requestOptions?: HTTPServiceRequestOptions;

    protocol?: 'http' | 'https';
    hostName?: string;
    port?: number;
    baseUri?: string;

    baseParams?: { [k: string]: string | string[]; };
    baseHeaders?: { [k: string]: string | string[]; };
}

export class HTTPServiceError<T extends HTTPServiceRequestOptions = HTTPServiceRequestOptions> extends Error {
    serial: number;
    status?: string | number;
    config?: T;
    response?: Response;

    override cause?: Error | { [k: string]: any; } | null;

    get err() {
        return this.cause as Error | { [k: string]: any; } | null;
    }

    set err(input: Error | { [k: string]: any; } | null) {
        this.cause = input;
    }

    constructor(serial: number, options?: {
        err?: Error;
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

    baseParams: { [k: string]: string | string[]; };
    baseHeaders: { [k: string]: string | string[]; };

    counter: number = 0;

    // tslint:disable-next-line:variable-name
    Error: typeof HTTPServiceError = HTTPServiceError;

    constructor(baseUrl: string, config: Tc = {} as any) {
        super();
        patchErrorCaptureStackTraceIfNeeded();
        this.config = _.defaults(config, {
            requestOptions: {},
            baseParams: {},
            baseHeaders: {},
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
            url.pathname = `${this.baseURL.pathname}${url.pathname}`.replace(/\/+/g, '/');
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
    ): PromiseWithCancel<Response & { data: T; parsed: T; } & FetchPatch<To>> {
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

        const headers = new Headers(options.headers);
        options.headers = headers;
        if (options.responseType) {
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
        let timeoutTimer: ReturnType<typeof setTimeout>;
        if (options.timeout) {
            timeoutTimer = setTimeout(() => {
                (abortCtrl as any).abort(`Timeout of ${options.timeout}ms exceeded`);
            }, options.timeout);
        }
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
                        parsed: { value: parsed, writable: true },
                    });

                    this.emit('parsed', parsed, r, serial);

                    deferred.resolve(r);

                    return;
                } catch (err: any) {
                    const newErr = new this.Error(serial, {
                        err,
                        config: _.omit(config, ['body']),
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
                    config: _.omit(config, ['body']),
                    status: err.code || err.errno
                });

                this.emit('exception', newErr, undefined, serial);
                deferred.reject(newErr);
            }
        ).finally(() => {
            if (timeoutTimer) {
                clearTimeout(timeoutTimer);
            }
        });
        if (options.timeout) {
            setTimeout(() => {
                (abortCtrl as any).abort(`Timeout of ${options.timeout}ms exceeded`);
            }, options.timeout);
        }

        return deferred.promise as any;
    }

    async __processResponse(options: HTTPServiceRequestOptions, r: Response) {
        const contentType = r.headers.get('Content-Type');
        let bodyParsed: any = null;
        do {
            if (options.raw) {
                break;
            }
            if (r.status === 204) {
                bodyParsed = '';
                break;
            }
            if (options.responseType === 'json') {
                bodyParsed = await r.json();
                break;
            } else if (options.responseType === 'text') {
                bodyParsed = await r.text();
                break;
            } else if (options.responseType === 'buffer') {
                bodyParsed = r.arrayBuffer().then((x) => Buffer.from(x));
                break;
            } else if (options.responseType === 'blob') {
                bodyParsed = r.blob();
                break;
            } else if (options.responseType === 'stream' && r.body) {
                // WebStream sucks. Node stream is the real stream.
                const abortCtrl = new AbortController();
                bodyParsed = Readable.fromWeb(r.body, { signal: abortCtrl.signal });
                bodyParsed.cancel = abortCtrl.abort.bind(abortCtrl);
                break;
            }
            if (contentType?.startsWith('application/json')) {
                bodyParsed = await r.text();
                try {
                    bodyParsed = JSON.parse(bodyParsed);
                } catch (err) {
                    // Invalid response
                    void 0;
                }
            } else if (contentType?.startsWith('text/')) {
                bodyParsed = await r.text();
            }
            break;
            // eslint-disable-next-line no-constant-condition
        } while (false);

        if (r.ok) {
            return bodyParsed === null ? r : bodyParsed;
        }

        throw bodyParsed === null ? r : (typeof bodyParsed === 'object' ? bodyParsed : new Error(`${bodyParsed}`));
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
        multipart: Array<[string, File | Blob | string, string?]> = [],
        options?: To
    ) {
        const form = new FormData();

        for (const [k, v, o] of multipart) {
            if (v === null || v === undefined) {
                continue;
            }
            if (o === undefined) {
                form.append(k, v);
                continue;
            }
            form.append(k, v, o);
        }

        return this.__request<T>(
            'POST',
            uri,
            searchParams,
            { body: form } as any,
            options
        );
    }
    postMultipart<T = any>(
        uri: string,
        multipart: Array<[string, File | Blob | string, string?]> = [],
        options?: To
    ) {
        return this.postMultipartWithSearchParams<T>(uri, undefined, multipart, options);
    }

    postBinaryWithSearchParams<T = any>(
        uri: string,
        searchParams: any = {},
        binary: Readable | ReadableStream | Buffer | Blob | File | string,
        options?: To
    ) {
        let thingToSend = binary;
        if (isReadable(binary as any)) {
            thingToSend = Readable.toWeb(binary as Readable);
        } else if (Buffer.isBuffer(binary)) {
            thingToSend = new Blob([binary]);
        } else if (typeof binary === 'string') {
            thingToSend = new Blob([Buffer.from(binary, 'utf-8')]);
        }

        return this.__request<T>(
            'POST',
            uri,
            searchParams,
            { body: thingToSend } as any,
            options
        );
    }
    postBinary<T = any>(
        uri: string,
        binary: Readable | ReadableStream | Buffer | Blob | File | string,
        options?: To
    ) {
        return this.postBinaryWithSearchParams<T>(uri, undefined, binary, options);
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
    setupCookieEvents() {
        this.on('response', (resp, serial) => {
            const setCookieHeader = resp.headers.get('set-cookie');
            if (Array.isArray(setCookieHeader)) {
                for (const x of setCookieHeader) {
                    this.emit('set-cookie', x, resp, serial);
                }
            } else if (setCookieHeader) {
                this.emit('set-cookie', setCookieHeader, resp, serial);
            }
        });
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
// eslint-enable max-len

export type HTTPServiceResponse<T> = Response & { data: T; };
