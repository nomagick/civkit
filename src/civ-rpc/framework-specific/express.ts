import { Readable } from 'stream';
import os from 'os';
import http, { IncomingHttpHeaders } from 'http';
import type http2 from 'http2';
import { randomUUID } from 'crypto';

import _ from 'lodash';
import busboy from 'busboy';
import express from 'express';

import {
    AbstractTempFileManger, AsyncService, Defer,
    LoggerInterface, mimeOf, NDJsonStream, parseContentType,
    restoreContentType, TimeoutError
} from "../../lib";
import { RPCHost, RPC_CALL_ENVIRONMENT } from "../base";
import { DataStreamBrokenError } from "../errors";
import { extractTransferProtocolMeta, TransferProtocolMetadata } from "../meta";
import { AbstractRPCRegistry } from "../registry";
import { OpenAPIManager } from "../openapi";
import { runOnce } from "../../decorators";
import { humanReadableDataSize } from "../../utils/readability";
import { marshalErrorLike } from '../../utils/lang';

import { cleanParams, UploadedFile } from "./shared";
import { AbstractAsyncContext, setupTraceId } from '../../lib/async-context';
export { UploadedFile } from './shared';


export abstract class ExpressRegistry extends AbstractRPCRegistry {
    protected abstract logger: LoggerInterface;
    protected abstract tempFileManager: AbstractTempFileManger;
    protected abstract ctxMgr: AbstractAsyncContext;
    abstract title: string;
    logoUrl?: string;

    openAPIManager = new OpenAPIManager();

    _RECEIVE_TIMEOUT = 60 * 60 * 1000;
    _MULTIPART_LIMITS: busboy.Limits = {
        fieldNameSize: 1024,
        fieldSize: 1024 * 1024 * 2,
    };
    _BODY_PARSER_LIMIT = '50mb';

    _hack_block_unauthorized_send = false;

    expressMiddlewares = [
        express.json({ limit: this._BODY_PARSER_LIMIT }),
        express.urlencoded({ extended: true, limit: this._BODY_PARSER_LIMIT }),
        this.__CORSAllowAllMiddleware.bind(this),
        this.__multiParse.bind(this)
    ];

    protected __routerRegister(router: express.Router, url: string, methods: string[], controller: express.RequestHandler) {
        for (const method of methods) {
            const func = Reflect.get(router, method.toLowerCase());
            if (!func) {
                continue;
            }
            func.call(router, url, ...this.expressMiddlewares, controller);
        }
    }

    registerMethodsToExpressRouter(expressRouter: express.Router, openapiJsonPath = '/openapi.json') {
        for (const [methodName, , methodConfig] of this.dump()) {
            const httpConfig: {
                action?: string | string[];
                path?: string;
            } | undefined = methodConfig.proto?.http || methodConfig.ext?.http;

            let methods = ['post'];
            if (httpConfig?.action) {
                if (typeof httpConfig.action === 'string') {
                    methods.push(httpConfig.action);
                } else if (Array.isArray(httpConfig.action)) {
                    methods.push(...httpConfig.action);
                }
            }
            methods = _(methods).uniq().compact().map((x) => x.toLowerCase()).value();

            const theController = this.makeShimController(methodName);

            const httpRegistered = new WeakSet();
            if (httpConfig?.path && !httpRegistered.has(methodConfig)) {
                httpRegistered.add(methodConfig);
                const regUrl = `/${httpConfig.path}`.replace(/^\/+/, '/');
                this.__routerRegister(
                    expressRouter,
                    regUrl,
                    methods,
                    theController
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
                    this.__routerRegister(
                        expressRouter,
                        regUrl,
                        methodsToFillNoop,
                        this.__noop
                    );
                }

                if (process.env.DEBUG) {
                    this.logger.debug(
                        `HTTP Route: ${methods.map((x) => x.toUpperCase())} /${httpConfig.path} => rpc(${methodName})`,
                        { httpConfig }
                    );
                }
            }

            const name = methodName;
            const apiPath = `/${name.split('.').join('/')}`;
            this.__routerRegister(
                expressRouter,
                apiPath,
                methods,
                theController
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
                this.__routerRegister(
                    expressRouter,
                    apiPath,
                    methodsToFillNoop,
                    this.__noop
                );
            }

            if (process.env.DEBUG) {
                this.logger.debug(
                    `HTTP Route: ${methods.map((x) => x.toUpperCase())} ${apiPath} => rpc(${methodName})`,
                    { httpConfig }
                );
            }

            const rpcPath = `/rpc/${name}`;
            this.__routerRegister(
                expressRouter,
                rpcPath,
                methods,
                theController
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
                this.__routerRegister(
                    expressRouter,
                    rpcPath,
                    methodsToFillNoop,
                    this.__noop
                );
            }
            if (process.env.DEBUG) {
                this.logger.debug(
                    `HTTP Route: ${methods.map((x) => x.toUpperCase())} ${rpcPath} => rpc(${methodName})`,
                    { httpConfig }
                );
            }

        }

        this.__routerRegister(
            expressRouter,
            openapiJsonPath, ['get'],
            (req, res) => {
                const baseURL = new URL(req.url);
                baseURL.pathname = baseURL.pathname.replace(new RegExp(`${openapiJsonPath}$`, 'i'), '').replace(/\/+$/g, '');
                baseURL.search = '';
                const content = this.openAPIManager.createOpenAPIObject(baseURL.toString(), {
                    info: {
                        title: this.title,
                        description: `${this.title} openAPI documentations`,
                        'x-logo': {
                            url: this.logoUrl || `https://www.openapis.org/wp-content/uploads/sites/3/2018/02/OpenAPI_Logo_Pantone-1.png`
                        }
                    }
                }, (this.constructor as typeof AbstractRPCRegistry).envelope, req.query as any);
                res.statusCode = 200;
                res.end(JSON.stringify(content));
            });
    }

    protected applyTransferProtocolMeta(res: express.Response, protocolMeta?: TransferProtocolMetadata) {
        if (protocolMeta) {
            if (Number.isInteger(protocolMeta.code)) {
                res.statusCode = protocolMeta.code!;
            }
            if (protocolMeta.contentType) {
                res.set('Content-Type', protocolMeta.contentType);
            }
            if (protocolMeta.headers) {
                for (const [key, value] of Object.entries(protocolMeta.headers)) {
                    if (value === undefined) {
                        continue;
                    }
                    res.set(key, value);
                }
            }
        }
    }

    makeShimController(methodName: string) {
        const conf = this.conf.get(methodName);
        if (!conf) {
            throw new Error(`Unknown rpc method: ${methodName}`);
        }

        return async (req: express.Request, res: express.Response) => {
            if (this._hack_block_unauthorized_send) {
                const hdl = () => {
                    // eslint-disable-next-line prefer-rest-params
                    this.logger.warn(`Unauthorized send detected, headers: ${JSON.stringify((res as any)._headers)}`, { arguments, headers: (res as any)._headers });
                };
                Reflect.set(res, '_send', hdl);
                Reflect.set(res, 'send', hdl);
                Reflect.set(res, 'end', hdl);
            }

            const jointInput = {
                ...req.query,
                ...(_.isPlainObject(req.body) ? req.body : {}),
                ...cleanParams(req.params),
            };

            res.statusCode = 404;
            const keepAliveTimer = setTimeout(() => {
                if (res.socket) {
                    res.socket.setKeepAlive(true, 2 * 1000);
                }
            }, 2 * 1000);
            let done = false;
            try {
                await this.serviceReady();
                const rpcHost = this.host(methodName) as RPCHost;
                const hostIsAsyncService = rpcHost instanceof AsyncService;
                if (hostIsAsyncService && rpcHost.serviceStatus !== 'ready') {
                    // RPC host may be crippled, if this is the case, assert its back up again.
                    this.logger.info(`${rpcHost.constructor.name} is not ready upon a request, trying to bring it up...`);
                    await rpcHost.serviceReady();
                    this.logger.info(`${rpcHost.constructor.name} recovered successfully`);
                }

                const abortController = new AbortController();
                res.once('close', () => {
                    if (!done) {
                        abortController.abort('Connection closed by the other end.');
                    }
                });

                const result = await this.ctxMgr.run(() => {
                    const ctx = this.ctxMgr.ctx;
                    Object.setPrototypeOf(ctx, { req, res });
                    return this.call(methodName, jointInput, { env: ctx, signal: abortController.signal });
                });
                const output = result.output;
                clearTimeout(keepAliveTimer);
                if (this._hack_block_unauthorized_send) {
                    Reflect.set(res, '_header', null);
                    Reflect.deleteProperty(res, '_send');
                    Reflect.deleteProperty(res, 'send');
                    Reflect.deleteProperty(res, 'end');
                }

                // eslint-disable-next-line @typescript-eslint/no-magic-numbers
                if (res.statusCode === 404) {
                    res.statusCode = 200;
                }

                if (output instanceof Readable || (typeof output?.pipe) === 'function') {
                    res.socket?.setKeepAlive(true, 1000);

                    this.applyTransferProtocolMeta(res, result.tpm);
                    if (output.readableObjectMode) {
                        const transformStream = new NDJsonStream();
                        this.applyTransferProtocolMeta(res, extractTransferProtocolMeta(transformStream));
                        output.pipe(transformStream, { end: true });
                        transformStream.pipe(res, { end: true });
                    } else {
                        output.pipe(res);
                    }
                    res.once('close', () => {
                        if (!output.readableEnded) {
                            this.logger.warn(`Response stream closed before readable ended, probably downstream socket closed.`);
                            output.once('error', (err: any) => {
                                this.logger.warn(`Error occurred in response stream: ${err}`, {
                                    err
                                });
                            });
                            output.destroy(new Error('Downstream socket closed'));
                        }
                    });
                    output.once('end', () => { done = true; });
                } else if (Buffer.isBuffer(output)) {
                    if (!(result.tpm?.contentType)) {
                        const contentType = restoreContentType(await mimeOf(output));
                        res.set('Content-Type', contentType);
                    }
                    this.applyTransferProtocolMeta(res, result.tpm);
                    done = true;
                    res.end(output);
                } else if (output instanceof Blob) {
                    if (output.type) {
                        res.set('Content-Type', output.type);
                    }
                    if (output.size) {
                        res.set('Content-Length', `${output.size}`);
                    }
                    const fname = (output as any).name;
                    if (fname) {
                        res.set('Content-Disposition', `attachment; filename="${fname}"; filename*=UTF-8''${encodeURIComponent(fname)}`);
                    }
                    res.socket?.setKeepAlive(true, 1000);
                    this.applyTransferProtocolMeta(res, result.tpm);
                    const nodeStream = Readable.fromWeb(output.stream());
                    nodeStream.once('end', () => { done = true; });
                    nodeStream.pipe(res, { end: true });
                    res.once('close', () => {
                        if (!nodeStream.readableEnded) {
                            this.logger.warn(`Response stream closed before readable ended, probably downstream socket closed.`);
                            nodeStream.once('error', (err: any) => {
                                this.logger.warn(`Error occurred in response stream: ${err}`, {
                                    err
                                });
                            });
                            nodeStream.destroy(new Error('Downstream socket closed'));
                        }
                    });
                } else if (typeof output === 'string') {
                    res.set('Content-Type', 'text/plain; charset=utf-8');
                    this.applyTransferProtocolMeta(res, result.tpm);
                    done = true;
                    res.end(output);
                } else {
                    res.set('Content-Type', 'application/json; charset=utf-8');
                    this.applyTransferProtocolMeta(res, result.tpm);
                    done = true;
                    res.end(JSON.stringify(output));
                }

                if (!result.succ) {
                    this.logger.warn(`Error serving incoming request`, { brief: this.briefExpressRequest(req, res), err: marshalErrorLike(result.err) });
                    if (result.err?.stack) {
                        this.logger.warn(`Stacktrace: \n`, result.err?.stack);
                    }
                }
            } catch (err: any) {
                if (this._hack_block_unauthorized_send) {
                    Reflect.deleteProperty(res, '_send');
                    Reflect.deleteProperty(res, 'send');
                    Reflect.deleteProperty(res, 'end');
                }
                // Note that the shim controller doesn't suppose to throw any error.
                clearTimeout(keepAliveTimer);
                this.logger.warn(`Error serving incoming request`, { brief: this.briefExpressRequest(req, res), err: marshalErrorLike(err) });
                if (err?.stack) {
                    this.logger.warn(`Stacktrace: \n`, err?.stack);
                }
                done = true;
                res.end(`${JSON.stringify(marshalErrorLike(err))}`);
            }
        };
    }

    briefHeaders(headers: IncomingHttpHeaders) {
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(headers)) {
            if (typeof value === 'string') {
                result[key] = value;
            } else if (Array.isArray(value)) {
                result[key] = value.join(',');
            } else {
                result[key] = `${value}`;
            }
        }

        if (result.authorization) {
            // eslint-disable-next-line @typescript-eslint/no-magic-numbers
            result.authorization = `[REDACTED ${result.authorization.length} characters ends with ${result.authorization.slice(-4)}]`;
        }

        if (result.cookie) {
            // eslint-disable-next-line @typescript-eslint/no-magic-numbers
            result.cookie = `[REDACTED ${result.cookie.length} characters]`;
        }

        return result;
    }

    briefExpressRequest(req: express.Request, res: express.Response) {
        return {
            code: res.statusCode,
            resp: this.briefBody(req.body),

            ip: req.ip,
            ips: req.ips,
            host: req.hostname,
            method: req.method,
            url: req.originalUrl,
            headers: this.briefHeaders(req.headers),
            traceId: this.ctxMgr.get('traceId'),
            traceT0: this.ctxMgr.get('traceT0'),
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
    override async exec(name: string, input: object, env?: object, signal?: AbortSignal) {
        this.emit('run', name, input, env);
        const startTime = Date.now();
        try {
            const result = await super.exec(name, input, env, signal);

            this.emit('ran', name, input, result, startTime, env);

            return result;
        } catch (err) {

            this.emit('fail', err, name, input, startTime, env);

            throw err;
        }

    }

    protected async __multiParse(req: express.Request, res: express.Response, next: express.NextFunction) {
        if (
            !req.headers['content-type'] ||
            !(req.headers['content-type'].indexOf('multipart/form-data') >= 0)
        ) {
            return next();
        }

        const boy = busboy({
            headers: req.headers,
            limits: this._MULTIPART_LIMITS,
        });

        const allFiles: UploadedFile[] = [];
        if (!req.body) {
            req.body = {
                __files: allFiles,
            };
        }

        const reqBody = req.body as Record<string, any>;

        Reflect.set(req, 'files', allFiles);

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
                if (Array.isArray(reqBody[realFieldName])) {
                    reqBody[realFieldName].push(parsedVal);
                } else {
                    reqBody[realFieldName] = [parsedVal];
                }
            } else {
                reqBody[decodedFieldName] = parsedVal;
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
                if (Array.isArray(reqBody[realFieldName])) {
                    reqBody[realFieldName].push(file);
                } else {
                    reqBody[realFieldName] = [file];
                }
            } else {
                reqBody[decodedFieldName] = file;
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

        req.pipe(boy);

        await deferred.promise;

        try {
            return next();
        } finally {
            res.once('close', () => {
                deletionOfFiles().catch(this.logger.warn);
            });
        }
    }

    protected async __binaryParse(req: express.Request, res: express.Response, next: express.NextFunction) {
        if (!_.isEmpty(req.body)) {
            return next();
        }

        let useTimeout = false;
        if (!req.headers['content-length']) {
            useTimeout = true;
        }
        const mimeVec = parseContentType(req.headers['content-type'] || 'application/octet-stream');
        const cachedFile = this.tempFileManager.cacheReadable(req) as UploadedFile;
        if (useTimeout) {
            const timer = setTimeout(() => {
                req.destroy(new TimeoutError(`Unbounded request timedout after ${this._RECEIVE_TIMEOUT} ms`));
            }, this._RECEIVE_TIMEOUT);

            req.once('end', () => clearTimeout(timer));
        }

        if (mimeVec) {
            cachedFile.claimedContentType = mimeVec;
        }

        req.body = {
            __files: [cachedFile],
            file: cachedFile,
        };

        const reqBody = req.body as Record<string, any>;

        Reflect.set(req, 'files', reqBody.__files);

        try {
            await cachedFile.ready;

            return next();
        } finally {
            res.once('close', () => {
                cachedFile.unlink().catch(this.logger.warn);
            });
        }
    }

    protected __CORSAllowOnceMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
        if (req.method.toUpperCase() !== 'OPTIONS') {
            return next();
        }
        const requestOrigin = req.headers.origin;
        if (!requestOrigin) {
            return next();
        }
        res.set('Access-Control-Allow-Origin', requestOrigin);

        const customMethod = req.headers['Access-Control-Request-Method'.toLowerCase()];
        const customHeaders = req.headers['Access-Control-Request-Headers'.toLowerCase()];
        if (customMethod) {
            res.set('Access-Control-Allow-Methods', customMethod);
        }
        if (customHeaders) {
            res.set('Access-Control-Allow-Headers', customHeaders);
        }
        res.set('Access-Control-Allow-Credentials', 'true');

        res.statusCode = 200;

        return;
    }

    protected __CORSAllowAllMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
        const requestOrigin = req.headers.origin;
        if (!requestOrigin) {
            return next();
        }
        res.set('Access-Control-Allow-Origin', requestOrigin);
        res.set('Access-Control-Max-Age', '25200');
        res.set('Access-Control-Allow-Credentials', 'true');
        if (req.method.toUpperCase() !== 'OPTIONS') {
            return next();
        }
        res.statusCode = 200;
        const customMethod = req.headers['Access-Control-Request-Method'.toLowerCase()];
        const customHeaders = req.headers['Access-Control-Request-Headers'.toLowerCase()];
        if (customMethod) {
            res.set('Access-Control-Allow-Methods',
                ['GET', 'POST', 'OPTIONS', 'HEAD', 'PUT', 'DELETE', 'PATCH', 'TRACE'].join(',')
            );
        }
        if (customHeaders) {
            res.set('Access-Control-Allow-Headers', customHeaders);
        }

        return next();
    }

    protected __noop(_req: express.Request, res: express.Response) {
        res.status(200);

        return res.end();
    }

    async registerParticularRoute(
        rpcMethod: string,
        expressRouter: express.Router,
        qPath: string,
    ) {
        const methodConfig = this.conf.get(rpcMethod);
        if (!methodConfig) {
            throw new Error(`No such rpc method: ${rpcMethod}`);
        }
        const httpConfig: {
            action?: string | string[];
            path?: string;
        } | undefined = methodConfig.proto?.http || methodConfig.ext?.http;

        let methods = ['post'];
        if (httpConfig?.action) {
            if (typeof httpConfig.action === 'string') {
                methods.push(httpConfig.action);
            } else if (Array.isArray(httpConfig.action)) {
                methods.push(...httpConfig.action);
            }
        }
        methods = _(methods).uniq().compact().map((x) => x.toLowerCase()).value();

        this.__routerRegister(
            expressRouter,
            qPath,
            methods,
            this.makeShimController(rpcMethod)
        );

        const methodsToFillNoop = _.pullAll(['head', 'options'], methods);

        if (methodsToFillNoop.length) {
            this.__routerRegister(
                expressRouter,
                qPath,
                methodsToFillNoop,
                this.__noop
            );
        }
        if (process.env.DEBUG) {
            this.logger.debug(
                `HTTP Route: ${methods.map((x) => x.toUpperCase())} ${qPath} => rpc(${rpcMethod})`,
                { httpConfig }
            );
        }
    }
}

export interface ExpressRPCRegistry {
    on(event: 'run', listener: (name: string, input: {
        [RPC_CALL_ENVIRONMENT]: any;
        [k: string]: any;
    }) => void): this;
    on(event: 'ran', listener: (name: string, input: {
        [RPC_CALL_ENVIRONMENT]: any;
        [k: string]: any;
    }, result: unknown) => void, startTimeTs: number): this;
    on(event: 'fail', listener: (err: Error, name: string, input: {
        [RPC_CALL_ENVIRONMENT]: any;
        [k: string]: any;
    }) => void, startTimeTs: number): this;

    on(event: 'ready', listener: () => void): this;
    on(event: 'crippled', listener: (err?: Error | any) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
}

export abstract class ExpressServer extends AsyncService {
    protected abstract logger: LoggerInterface;
    healthCheckEndpoint = '/ping';

    expressApp: express.Express = express();
    expressRootRouter: express.Router = express.Router();

    httpServer!: http.Server | http2.Http2Server;

    listening = false;

    shutdownGraceTimeout = 33_000;

    constructor(..._args: any[]) {
        super(...arguments);
        this.expressApp.set('trust proxy', true);
        this.init()
            .catch((err) => {
                this.logger.error(`Server start failed: ${err.toString()}`, err);
                if (err.stack) {
                    this.logger.error(`Stacktrace: \n${err?.stack}`);
                }
                process.nextTick(() => this.emit('error', err));
            });
    }

    override async init() {
        await this._init();
    }

    async _init() {
        await this.dependencyReady();
        this.logger.info(`Server starting at ${os.hostname()}(${process.pid}) ${os.platform()}_${os.release()}_${os.arch()} ${process.title}_${process.version}`);

        this.featureSelect();

        this.expressApp.use(this.expressRootRouter);

        this.logger.info('Server dependency ready');

        this.httpServer = http.createServer(this.expressApp);

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

            this.listening = true;
            this.logger.info(`${this.httpServer.constructor.name} listening on port ${port}`);
        });
    }

    abstract registerRoutes(): void;

    @runOnce()
    registerOpenAPIDocsRoutes(url: string = 'docs', openapiUrl: string = '/openapi.json') {
        this.expressRootRouter.get(url, (req, res) => {
            const content = `<!DOCTYPE html>
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
    <div id="redoc-container"></div>
    <script src="https://cdn.jsdelivr.net/npm/redoc@latest/bundles/redoc.standalone.js"> </script>
    <script>
      document.addEventListener('DOMContentLoaded', function() {
            Redoc.init('${openapiUrl}${new URL(req.originalUrl, `${req.protocol}://${req.headers.host}`).search}',
            {},
            document.getElementById('redoc-container'),
            ()=> {
                const apiTitle = document.querySelector('.api-info>h1').innerText;
                if (apiTitle) {
                    document.title = apiTitle;
                }
            });
      });
    </script>
  </body>
</html>
`;

            res.status(200).end(content);
        });
    }

    @runOnce()
    insertAsyncHookMiddleware() {
        const asyncHookMiddleware = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
            const googleTraceId = req.get('x-cloud-trace-context')?.split('/')?.[0];
            setupTraceId(req.get('x-request-id') || req.get('request-id') || googleTraceId || randomUUID());

            return next();
        };

        this.expressApp.use(asyncHookMiddleware);
    }

    @runOnce()
    insertLogRequestsMiddleware() {

        const loggingMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
            const startedAt = Date.now();
            const url = req.originalUrl.replace(/secret=\w+/, 'secret=***');
            if (['GET', 'DELETE', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
                this.logger.info(`Incoming request: ${req.method.toUpperCase()} ${url} ${req.ip}`, { service: 'HTTP Server' });
            } else {
                this.logger.info(`Incoming request: ${req.method.toUpperCase()} ${url} ${req.get('content-type') || 'unspecified-type'} ${humanReadableDataSize(req.get('content-length') || req.socket.bytesRead) || 'N/A'} ${req.ip}`, { service: 'HTTP Server' });
            }

            res.once('close', () => {
                const duration = Date.now() - startedAt;
                this.logger.info(`Request completed: ${res.statusCode} ${req.method.toUpperCase()} ${url} ${res.get('content-type') || 'unspecified-type'} ${humanReadableDataSize(res.get('content-length') || res.socket?.bytesWritten) || 'cancelled'} ${duration}ms`, { service: 'HTTP Server' });
            });

            return next();
        };

        this.expressApp.use(loggingMiddleware);
    }

    @runOnce()
    insertHealthCheckMiddleware(path: string = '/ping') {
        const healthCheck = async (_req: express.Request, res: express.Response) => {
            if (this.serviceStatus === 'ready') {
                res.status(200).end('pone');

                return;
            }

            try {
                await this.serviceReady();

                res.status(200).end('pone');

            } catch (err: any) {
                res.status(503).end(err.toString());
                this.logger.error('Service not ready upon health check', { err });
            }
        };

        this.expressRootRouter.get(path, healthCheck);
    }

    override async standDown() {
        if (this.listening) {
            this.logger.info('Server closing...');
            if (this.httpServer instanceof http.Server) {
                this.httpServer.closeIdleConnections();
            }
            await new Promise<void>((resolve, reject) => {
                const timer = setInterval(async () => {
                    if (this.httpServer instanceof http.Server) {
                        this.httpServer.closeIdleConnections();
                    }
                    const connsLeft = await new Promise((resolve) => this.httpServer.getConnections((err, c) => {
                        if (err) { return resolve(undefined); }
                        return resolve(c);
                    }));
                    this.logger.warn(`Waiting for ${connsLeft} remaining connections`);
                }, 1000).unref();
                const timer2 = setTimeout(async () => {
                    this.logger.warn(`Timed out waiting for connections to gracefully close. Skipping...`);
                    reject(new TimeoutError('Timed out waiting for connections to gracefully close.'));
                }, this.shutdownGraceTimeout).unref();


                this.httpServer.close((err) => {
                    if (err) {
                        return reject(err);
                    }
                    clearInterval(timer);
                    clearTimeout(timer2);
                    resolve();
                });

            });

            this.listening = false;
        }
        super.standDown();
    }
}
