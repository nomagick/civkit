
import _ from "lodash";
import busboy from 'busboy';

import os from 'os';

import { Readable } from 'stream';
import type { Context, Middleware } from 'koa';
import Koa from 'koa';
import compose from 'koa-compose';
import KoaRouter from '@koa/router';

import bodyParser from "koa-bodyparser";
import {
    AbstractTempFileManger, AsyncService, Defer, FancyFile,
    LoggerInterface, mimeOf, MIMEVec, parseContentType,
    restoreContentType, TimeoutError
} from "../lib";
import { RPCHost, RPC_CALL_ENVIROMENT } from "./base";
import { ApplicationError, DataStreamBrokenError } from "./errors";
import { extractMeta, extractTransferProtocolMeta } from "./meta";
import { AbstractRPCRegistry } from "./registry";
import { OpenAPIManager } from "./openapi";
import http from "http";
import { runOnce } from "decorators";
import { createHook, executionAsyncResource } from "async_hooks";
import { humanReadableDataSize } from "utils/readability";
import { randomUUID } from "crypto";
import { TraceableInterface, TRACE_ID } from "../lib/logger";


export type ParsedContext = Context & {
    request: { body: { [key: string]: any; }; };
    files: UploadedFile[];
};

export type UploadedFile = FancyFile & {
    field?: string;
    claimedName?: string;
    claimedContentType?: MIMEVec | null;
    claimedMime?: string;
};

export abstract class KoaRPCRegistry extends AbstractRPCRegistry {
    abstract logger: LoggerInterface;
    abstract tempFileManager: AbstractTempFileManger;
    abstract title: string;
    logoUrl?: string;

    openAPIManager = new OpenAPIManager();

    _RECEIVE_TIMEOUT = 60 * 60 * 1000;
    _MULTIPART_LIMITS: busboy.Limits = {
        fieldNameSize: 1024,
        fieldSize: 1024 * 1024 * 2,
    };
    _BODY_PARSER_LIMIT = '50mb';

    koaMiddlewares = [
        this.__CORSAllowAllMiddleware,
        bodyParser({
            enableTypes: ['json', 'form', 'text'],
            extendTypes: {
                text: ['application/xml', 'text/xml']
            },
            textLimit: this._BODY_PARSER_LIMIT,
            jsonLimit: this._BODY_PARSER_LIMIT,
            xmlLimit: this._BODY_PARSER_LIMIT,

        }),
        this.__multiParse
    ];

    registerMethodsToKoaRouter(koaRouter: KoaRouter) {
        for (const [methodName, , methodConfig] of this.dump()) {
            const httpConfig: {
                action?: string | string[];
                path?: string;
            } | undefined = methodConfig.ext?.http;

            let methods = ['post'];
            if (httpConfig?.action) {
                if (typeof httpConfig.action === 'string') {
                    methods.push(httpConfig.action);
                } else if (Array.isArray(httpConfig.action)) {
                    methods.push(...httpConfig.action);
                }
            }
            methods = _(methods).uniq().compact().map((x) => x.toLowerCase()).value();

            const theController = this.makeKoaShimController(methodName);

            if (httpConfig?.path) {
                const regUrl = `/${httpConfig.path}`.replace(/^\/+/, '/');
                koaRouter.register(
                    regUrl,
                    methods,
                    this.wipeBehindKoaRouter(
                        ...this.koaMiddlewares,
                        theController
                    )
                );
                this.openAPIManager.document(
                    regUrl.split('/').map((x) => x.startsWith(':') ? `{${x.substring(1)}}` : x).join('/'),
                    methods,
                    methodConfig,
                    {
                        style: 'http',
                        tags: methodName.split('.').filter(Boolean)
                    }
                );

                const methodsToFillNoop = _.pullAll(['head', 'options'], methods);
                if (methodsToFillNoop.length) {
                    koaRouter.register(
                        regUrl,
                        methodsToFillNoop,
                        this.wipeBehindKoaRouter(
                            ...this.koaMiddlewares,
                            this.__noop
                        )
                    );
                }

                this.logger.debug(
                    `HTTP Route: ${methods.map((x) => x.toUpperCase())} /${httpConfig.path} => rpc(${methodName})`,
                    { httpConfig }
                );
            }

            const methodNames = typeof methodConfig.name === 'string' ? [methodConfig.name] : methodConfig.name;
            for (const name of methodNames) {

                const apiPath = `/${name.split('.').join('/')}`;
                koaRouter.register(
                    apiPath,
                    methods,
                    this.wipeBehindKoaRouter(
                        ...this.koaMiddlewares,
                        theController
                    )
                );

                this.openAPIManager.document(
                    apiPath.split('/').map((x) => x.startsWith(':') ? `{${x.substring(1)}}` : x).join('/'),
                    methods,
                    methodConfig,
                    {
                        style: 'http',
                        tags: methodName.split('.').filter(Boolean)
                    }
                );

                const methodsToFillNoop = _.pullAll(['head', 'options'], methods);
                if (methodsToFillNoop.length) {
                    koaRouter.register(
                        apiPath,
                        methodsToFillNoop,
                        this.wipeBehindKoaRouter(
                            ...this.koaMiddlewares,
                            this.__noop
                        )
                    );
                }

                this.logger.debug(
                    `HTTP Route: ${methods.map((x) => x.toUpperCase())} ${apiPath} => rpc(${methodName})`,
                    { httpConfig }
                );

                const rpcPath = `/rpc/${name}`;
                koaRouter.register(
                    rpcPath,
                    methods,
                    this.wipeBehindKoaRouter(
                        ...this.koaMiddlewares,
                        theController
                    )
                );
                this.openAPIManager.document(
                    rpcPath.split('/').map((x) => x.startsWith(':') ? `{${x.substring(1)}}` : x).join('/'),
                    methods,
                    methodConfig,
                    {
                        style: 'rpc',
                        tags: methodName.split('.').filter(Boolean)
                    }
                );
                if (methodsToFillNoop.length) {
                    koaRouter.register(
                        rpcPath,
                        methodsToFillNoop,
                        this.wipeBehindKoaRouter(
                            ...this.koaMiddlewares,
                            this.__noop
                        )
                    );
                }
                this.logger.debug(
                    `HTTP Route: ${methods.map((x) => x.toUpperCase())} ${rpcPath} => rpc(${methodName})`,
                    { httpConfig }
                );
            }

        }

        koaRouter.register('/openapi.json', ['get'], this.wipeBehindKoaRouter(this.__CORSAllowAllMiddleware, (ctx) => {
            const baseURL = new URL(ctx.URL.toString());
            baseURL.pathname = baseURL.pathname.replace(/openapi\.json$/i, '').replace(/\/+$/g, '');
            baseURL.search = '';
            ctx.body = this.openAPIManager.createOpenAPIObject(baseURL.toString(), {
                info: {
                    title: this.title,
                    description: `${this.title} openapi document`,
                    'x-logo': {
                        url: this.logoUrl || `https://www.openapis.org/wp-content/uploads/sites/3/2018/02/OpenAPI_Logo_Pantone-1.png`
                    }
                }
            }, (this.constructor as typeof AbstractRPCRegistry).envelope, ctx.request.query);
        }));
    }

    makeSuccResponse(result: any) {
        const protocolMeta = extractTransferProtocolMeta(result);
        const data = {
            // eslint-disable-next-line @typescript-eslint/no-magic-numbers
            code: protocolMeta?.code || 200,
            // eslint-disable-next-line @typescript-eslint/no-magic-numbers
            status: protocolMeta?.status || 20000,
            data: result,
            meta: extractMeta(result)
        };

        return data;
    }

    makeErrResponse(err: Error) {

        const protocolMeta = extractTransferProtocolMeta(err);

        if (err instanceof ApplicationError) {

            return {
                code: err.code,
                status: err.status, data: null,
                message: `${err.name}: ${err.message}`,
                readableMessage: err.readableMessage
            };

        } else if (protocolMeta) {
            return {
                // eslint-disable-next-line @typescript-eslint/no-magic-numbers
                code: protocolMeta.code || 500,
                // eslint-disable-next-line @typescript-eslint/no-magic-numbers
                status: protocolMeta.status || 50000,
                data: null,
                message: `${err.name}: ${err.message}`,
            };
        }

        return { code: 500, status: 50000, message: `${err.name}: ${err.message}` };
    }

    makeKoaShimController(methodName: string) {
        const conf = this.conf.get(methodName);
        if (!conf) {
            throw new Error(`Unknown rpc method: ${methodName}`);
        }
        const rpcHost = this.host(methodName) as RPCHost;
        const hostIsAsyncService = rpcHost instanceof AsyncService;

        return async (ctx: Context, next: (err?: Error) => Promise<unknown>) => {

            const jointInput = {
                ...ctx.params,
                ...ctx.query,
                ...ctx.request.body,
                [RPC_CALL_ENVIROMENT]: ctx
            };

            ctx.status = 404;
            const keepAliveTimer = setTimeout(() => {
                ctx.socket.setKeepAlive(true, 2 * 1000);
            }, 2 * 1000);

            try {
                if (hostIsAsyncService && rpcHost.serviceStatus !== 'ready') {
                    // RPC host may be crippled, if this is the case, assert its back up again.
                    this.logger.info(`${rpcHost.constructor.name} is not ready upon a request, trying to bring it up...`);
                    await rpcHost.serviceReady();
                    this.logger.info(`${rpcHost.constructor.name} recovered successfully`);
                }

                const result = await this.exec(methodName, jointInput);
                clearTimeout(keepAliveTimer);

                // eslint-disable-next-line @typescript-eslint/no-magic-numbers
                if (ctx.status === 404) {
                    ctx.status = 200;
                }
                if (result instanceof FancyFile) {
                    ctx.socket.setKeepAlive(true, 1000);
                    const resolvedFile = await result.resolve();
                    ctx.respond = false;
                    ctx.type = await result.mimeType;
                    ctx.set('content-length', (await result.size).toString());
                    ctx.set('content-disposition', `attachment; filename="${await result.fileName}"`);
                    resolvedFile.createReadStream().pipe(ctx.res);
                } else if (result instanceof Readable || (typeof result?.pipe) === 'function') {
                    ctx.socket.setKeepAlive(true, 1000);
                    ctx.respond = false;
                    const meta = extractMeta(result);
                    const contentType = meta?.contentType || meta?.mimeType || 'application/octet-stream';
                    ctx.set('content-type', contentType);
                    (result as Readable).pipe(ctx.res);
                    ctx.res.once('close', () => {
                        if (!(result as Readable).readableEnded) {
                            (result as Readable).destroy(new Error('Downstream socket closed'));
                        }
                    });
                } else if (Buffer.isBuffer(result)) {
                    const mimeVec = await mimeOf(result);
                    const meta = extractMeta(result);
                    const contentType = meta?.contentType || meta?.mimeType || restoreContentType(mimeVec);
                    ctx.set('content-type', contentType);
                    ctx.body = result;
                } else {
                    const content = this.makeSuccResponse(result);
                    if (typeof content === 'object' && content !== null) {
                        ctx.set('content-type', 'application/json; charset=UTF-8');
                    }

                    ctx.body = content;
                }

            } catch (err: any) {
                clearTimeout(keepAliveTimer);
                const resp = this.makeErrResponse(err) as any;
                ctx.body = resp;
                // eslint-disable-next-line @typescript-eslint/no-magic-numbers
                ctx.status = resp.statusCode || resp.code || 500;

                this.logger.warn(`Error serving incoming request`, { brief: this.briefKoaRequest(ctx), err });
                if (err?.stack) {
                    this.logger.warn(`Stacktrace: \n`, err.stack);
                }
            }

            return next();
        };
    }

    wipeBehindKoaRouter(...middlewares: Middleware[]) {
        return compose(middlewares);
    }

    briefKoaRequest(ctx: Context) {
        return {
            code: ctx.response.status,
            resp: this.briefBody(ctx.body),

            ip: ctx.ip,
            ips: ctx.ips,
            host: ctx.host,
            method: ctx.method,
            url: ctx.request.originalUrl,
            headers: ctx.request.headers,
        };
    }

    briefBody(body: unknown) {
        if (Buffer.isBuffer(body)) {
            return `[Buffer(${body.byteLength})]`;
        }

        if (typeof (body as Readable)?.pipe === 'function') {
            return `[Stream]`;
        }

        if ((body as string)?.length > 1024) {
            return `[LargeTextAlike(${(body as string).length})]`;
        }

        return body;
    }
    override async exec(name: string, input: object) {
        this.emit('run', name, input);
        const startTime = Date.now();
        try {
            const result = await super.exec(name, input);

            this.emit('ran', name, input, result, startTime);

            return result;
        } catch (err) {

            this.emit('fail', err, name, input, startTime);

            throw err;
        }

    }

    protected async __multiParse(ctx: Context, next: () => Promise<void>) {
        if (
            !ctx.request.header['content-type'] ||
            !(ctx.request.header['content-type'].indexOf('multipart/form-data') >= 0)
        ) {
            return next();
        }

        const boy = busboy({
            headers: ctx.headers,
            limits: this._MULTIPART_LIMITS,
        });

        const allFiles: UploadedFile[] = [];
        if (!ctx.request.body) {
            ctx.request.body = {
                __files: allFiles,
            };
        }

        ctx.files = allFiles;

        boy.on('field', (
            fieldName,
            val,
            info
        ) => {
            const decodedFieldName = decodeURIComponent(fieldName);
            let parsedVal = val;
            if (info.mimeType.startsWith('application/json')) {
                try {
                    parsedVal = JSON.parse(val);
                } catch (_err) {
                    // swallow for now
                    // logger.warn({ err: err, fieldName, val }, 'Failed to parse JSON');
                }
            }

            if (decodedFieldName.endsWith('[]')) {
                const realFieldName = decodedFieldName.slice(0, decodedFieldName.length - 2);
                if (Array.isArray(ctx.request.body[realFieldName])) {
                    ctx.request.body[realFieldName].push(parsedVal);
                } else {
                    ctx.request.body[realFieldName] = [parsedVal];
                }
            } else {
                ctx.request.body[decodedFieldName] = parsedVal;
            }
        });

        boy.on('file', (fieldName, fileStream, info) => {
            const file: UploadedFile = this.tempFileManager.cacheReadable(fileStream as any, info.filename);
            const decodedFieldName = decodeURIComponent(fieldName);
            file.field = decodedFieldName;
            file.claimedName = info.filename;
            file.claimedMime = info.mimeType;
            file.claimedContentType = parseContentType(info.mimeType);

            if (decodedFieldName.endsWith('[]')) {
                const realFieldName = decodedFieldName.slice(0, decodedFieldName.length - 2);
                if (Array.isArray(ctx.request.body[realFieldName])) {
                    ctx.request.body[realFieldName].push(file);
                } else {
                    ctx.request.body[realFieldName] = [file];
                }
            } else {
                ctx.request.body[decodedFieldName] = file;
            }
            allFiles.push(file);
        });

        const deferred = Defer();
        const deletionOfFiles = () => {
            return Promise.all(allFiles.map((x) => x.unlink()));
        };
        boy.once('finish', () => {
            deferred.resolve(allFiles);
        });

        boy.once('error', (err: Error) => {
            deletionOfFiles().catch(this.logger.warn);
            deferred.reject(new DataStreamBrokenError(err));
        });

        ctx.req.pipe(boy);

        await deferred.promise;

        try {
            return await next();
        } finally {
            if (ctx.res.writable) {
                ctx.res.once('close', () => {
                    deletionOfFiles().catch(this.logger.warn);
                });
            } else {
                deletionOfFiles().catch(this.logger.warn);
            }
        }
    }

    protected async __binaryParse(ctx: Context, next: () => Promise<void>) {
        if (!_.isEmpty(ctx.request.body)) {
            return next();
        }

        let useTimeout = false;
        if (!ctx.request.header['content-length']) {
            useTimeout = true;
        }
        const mimeVec = parseContentType(ctx.request.header['content-type'] || 'application/octet-stream');
        const cachedFile = this.tempFileManager.cacheReadable(ctx.req) as UploadedFile;
        if (useTimeout) {
            const timer = setTimeout(() => {
                ctx.req.destroy(new TimeoutError(`Unbounded request timedout after ${this._RECEIVE_TIMEOUT} ms`));
            }, this._RECEIVE_TIMEOUT);

            ctx.req.once('end', () => clearTimeout(timer));
        }

        if (mimeVec) {
            cachedFile.claimedContentType = mimeVec;
        }

        ctx.request.body = {
            __files: [cachedFile],
            file: cachedFile,
        };

        ctx.files = ctx.request.body.__files;

        try {
            return await next();
        } finally {
            cachedFile.unlink().catch(this.logger.warn);
        }
    }

    protected __CORSAllowOnceMiddleware(ctx: Context, next: () => Promise<any>) {
        if (ctx.method.toUpperCase() !== 'OPTIONS') {
            return next();
        }
        const requestOrigin = ctx.request.header.origin;
        if (!requestOrigin) {
            return next();
        }
        ctx.response.set('Access-Control-Allow-Origin', requestOrigin);

        const customMethod = ctx.request.header['Access-Control-Request-Method'.toLowerCase()];
        const customHeaders = ctx.request.header['Access-Control-Request-Headers'.toLowerCase()];
        if (customMethod) {
            ctx.response.set('Access-Control-Allow-Methods', customMethod);
        }
        if (customHeaders) {
            ctx.response.set('Access-Control-Allow-Headers', customHeaders);
        }
        ctx.response.set('Access-Control-Allow-Credentials', 'true');

        ctx.status = 200;

        return;
    }

    protected __CORSAllowAllMiddleware(ctx: Context, next: () => Promise<any>) {
        const requestOrigin = ctx.request.header.origin;
        if (!requestOrigin) {
            return next();
        }
        ctx.response.set('Access-Control-Allow-Origin', requestOrigin);
        ctx.response.set('Access-Control-Max-Age', '25200');
        ctx.response.set('Access-Control-Allow-Credentials', 'true');
        if (ctx.method.toUpperCase() !== 'OPTIONS') {
            return next();
        }
        ctx.status = 200;
        const customMethod = ctx.request.header['Access-Control-Request-Method'.toLowerCase()];
        const customHeaders = ctx.request.header['Access-Control-Request-Headers'.toLowerCase()];
        if (customMethod) {
            ctx.response.set('Access-Control-Allow-Methods',
                ['GET', 'POST', 'OPTIONS', 'HEAD', 'PUT', 'DELETE', 'PATCH', 'TRACE'].join(',')
            );
        }
        if (customHeaders) {
            ctx.response.set('Access-Control-Allow-Headers', customHeaders);
        }

        return next();
    }

    protected __noop(ctx: Context, next: () => Promise<any>) {
        ctx.status = 200;
        ctx.body = '';

        return next();
    }
}

export interface RPCRegistry {
    on(event: 'run', listener: (name: string, input: {
        [RPC_CALL_ENVIROMENT]: any;
        [k: string]: any;
    }) => void): this;
    on(event: 'ran', listener: (name: string, input: {
        [RPC_CALL_ENVIROMENT]: any;
        [k: string]: any;
    }, result: unknown) => void, startTimeTs: number): this;
    on(event: 'fail', listener: (err: Error, name: string, input: {
        [RPC_CALL_ENVIROMENT]: any;
        [k: string]: any;
    }) => void, startTimeTs: number): this;

    on(event: 'ready', listener: () => void): this;
    on(event: 'crippled', listener: (err?: Error | any) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
}

export abstract class KoaServer extends AsyncService {
    abstract logger: LoggerInterface;
    healthCheckEndpoint = '/ping';

    koaApp: Koa = new Koa();
    koaRootRouter: KoaRouter = new KoaRouter();

    httpServer!: http.Server;

    constructor() {
        super(...arguments);
        this.koaApp.proxy = true;
        this.init()
            .catch((err) => {
                this.logger.error(`Server start failed: ${err.toString()}`, err);
                if (err.stack) {
                    this.logger.error(`Stacktrace: \n${err?.stack}`);
                }
                setImmediate(() => process.exit(1));
            });
    }

    override async init() {
        await this._init();
    }

    async _init() {
        await this.dependencyReady();
        this.logger.info(`Server starting at ${os.hostname()}(${process.pid}) ${os.platform()}_${os.release()}_${os.arch()}`);

        this.featureSelect();

        this.koaApp.use(this.koaRootRouter.routes());

        this.logger.info('Server dependency ready');

        process.on('uncaughtException', (err: any) => {
            this.logger.error(`Uncaught exception in pid ${process.pid}, quitting`, {
                pid: process.pid,
                err
            });
            this.logger.error(`Stacktrace: \n${err?.stack}`);

            setImmediate(() => process.exit(1));
        });

        process.on('unhandledRejection', (err: any) => {
            this.logger.warn(`Unhandled promise rejection in pid ${process.pid}`, {
                pid: process.pid,
                err
            });
            this.logger.warn(`Stacktrace: \n${err?.stack}`);
        });

        this.httpServer = http.createServer(this.koaApp.callback());

        this.emit('ready');
    }

    protected featureSelect() {
        this.insertAsyncHookMiddleware();
        this.insertHealthCheckMiddleware(this.healthCheckEndpoint);
        this.insertLogRequestsMiddleware();

        this.registerRoutes();
        this.registerOpenAPIDocsRoutes();
    }

    @runOnce()
    async listen(port: number = 3000) {
        await this.serviceReady();
        // eslint-disable-next-line @typescript-eslint/no-magic-numbers
        this.httpServer.listen(port, () => {
            this.logger.info(`Server listening on port ${port}`);
        });
    }

    abstract registerRoutes(): void;

    @runOnce()
    registerOpenAPIDocsRoutes() {
        this.koaRootRouter.get('/docs', async (ctx: Context) => {
            ctx.redirect('/docs/v2?style=rpc');
        });
        this.koaRootRouter.get('/docs/:apiVersion', async (ctx: Context) => {
            const apiVersion = ctx.params.apiVersion;
            ctx.body = `
            <!DOCTYPE html>
            <html>
              <head>
                <title>Redoc</title>
                <!-- needed for adaptive design -->
                <meta charset="utf-8"/>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">

                <!--
                Redoc doesn't change outer page styles
                -->
                <style>
                  body {
                    margin: 0;
                    padding: 0;
                  }
                </style>
              </head>
              <body>
                <redoc spec-url='/${apiVersion}/openapi.json?${ctx.querystring}'></redoc>
                <script src="https://cdn.jsdelivr.net/npm/redoc@latest/bundles/redoc.standalone.js"> </script>
              </body>
            </html>
            `;

        });
    }

    @runOnce()
    insertAsyncHookMiddleware() {
        createHook({
            init(_asyncId, _type, _triggerAsyncId, resource: TraceableInterface) {
                const currentResource: TraceableInterface = executionAsyncResource();
                if (currentResource) {
                    resource[TRACE_ID] = currentResource[TRACE_ID];
                }
            }
        }).enable();

        const asyncHookMiddleware = async (ctx: Context, next: () => Promise<void>) => {
            const currentResource: TraceableInterface = executionAsyncResource();
            if (currentResource) {
                currentResource[TRACE_ID] = ctx.get('x-request-id') || ctx.get('request-id') as string || randomUUID();
            }

            return next();
        };

        this.koaApp.use(asyncHookMiddleware);
    }

    @runOnce()
    insertLogRequestsMiddleware() {

        const loggingMiddleware = async (ctx: Context, next: () => Promise<void>) => {
            const startedAt = Date.now();
            const url = ctx.request.originalUrl.replace(/secret=\w+/, 'secret=***');
            if (['GET', 'DELETE', 'HEAD', 'OPTIONS'].includes(ctx.method.toUpperCase())) {
                this.logger.info(`Incoming request: ${ctx.request.method.toUpperCase()} ${url} ${ctx.ip}`, { service: 'HTTP Server' });
            } else {
                this.logger.info(`Incoming request: ${ctx.request.method.toUpperCase()} ${url} ${ctx.request.type || 'unspecified-type'} ${humanReadableDataSize(ctx.request.get('content-length') || ctx.request.socket.bytesRead) || 'N/A'} ${ctx.ip}`, { service: 'HTTP Server' });
            }

            ctx.res.once('close', () => {
                const duration = Date.now() - startedAt;
                this.logger.info(`Request completed: ${ctx.status} ${ctx.request.method.toUpperCase()} ${url} ${ctx.response.type || 'unspecified-type'} ${humanReadableDataSize(ctx.response.get('content-length') || ctx.res.socket?.bytesWritten) || 'cancelled'} ${duration}ms`, { service: 'HTTP Server' });
            });

            return next();
        };

        this.koaApp.use(loggingMiddleware);
    }

    @runOnce()
    insertHealthCheckMiddleware(path: string = '/ping') {
        const healthCheck = async (ctx: Context, next: () => Promise<void>) => {
            if (ctx.path !== path) {
                return next();
            }

            // No next() from here, so it returns directly without waking up any downstream logic.
            if (this.serviceStatus === 'ready') {
                ctx.status = 200;
                ctx.body = 'pone';

                return;
            }

            try {
                await this.serviceReady();

                ctx.status = 200;
                ctx.body = 'pone';

            } catch (err: any) {
                ctx.status = 503;
                ctx.body = err.toString();

                this.logger.error('Service not ready upon health check', { err });
            }
        };

        this.koaApp.use(healthCheck);
    }
}
