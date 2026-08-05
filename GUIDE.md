# The Civkit Guide

Onboarding guide for engineers and AI agents working with civkit, a TypeScript backend toolkit.

---

## Table of contents

- [The Civkit Guide](#the-civkit-guide)
  - [Table of contents](#table-of-contents)
  - [1. The mental model](#1-the-mental-model)
  - [2. AsyncService — services and lifecycle](#2-asyncservice--services-and-lifecycle)
  - [3. Coercible — data shapes](#3-coercible--data-shapes)
  - [4. civ-rpc — methods, registries, transports](#4-civ-rpc--methods-registries-transports)
    - [4.1 The mental model](#41-the-mental-model)
    - [4.2 Registries and their decorators](#42-registries-and-their-decorators)
    - [4.3 Defining endpoints](#43-defining-endpoints)
    - [4.4 Wiring HTTP: KoaServer / ExpressServer](#44-wiring-http-koaserver--expressserver)
    - [4.5 Registries beyond HTTP](#45-registries-beyond-http)
  - [5. Errors](#5-errors)
  - [6. The protocol layer: transfer-protocol meta and envelopes](#6-the-protocol-layer-transfer-protocol-meta-and-envelopes)
    - [6.1 `RPC_MARSHAL` — a value's own wire representation](#61-rpc_marshal--a-values-own-wire-representation)
    - [6.2 Transfer-protocol meta (TPM) — per-value protocol instructions](#62-transfer-protocol-meta-tpm--per-value-protocol-instructions)
    - [6.3 Envelopes — the response wrapper, chosen per call](#63-envelopes--the-response-wrapper-chosen-per-call)
    - [6.4 Streaming](#64-streaming)
  - [7. Async context](#7-async-context)
  - [8. Multithreading](#8-multithreading)
  - [9. Application architecture](#9-application-architecture)
    - [9.1 The universal idioms](#91-the-universal-idioms)
    - [9.2 Logger](#92-logger)
    - [9.3 Request context](#93-request-context)
    - [9.4 Auth — a DTO, not a middleware](#94-auth--a-dto-not-a-middleware)
    - [9.5 Persistence](#95-persistence)
    - [9.6 External HTTP APIs](#96-external-http-apis)
    - [9.7 CPU-heavy work](#97-cpu-heavy-work)
    - [9.8 Graceful shutdown \& temp files](#98-graceful-shutdown--temp-files)
  - [10. Infrastructure services catalog](#10-infrastructure-services-catalog)
  - [11. Method decorators](#11-method-decorators)
  - [12. Utility catalog](#12-utility-catalog)
  - [13. Environment setup](#13-environment-setup)

---

## 1. The mental model

Civkit applications are built from three primitives:

- a **stateful component** is an `AsyncService`;
- a **data shape** is a `Coercible` class;
- a **callable operation** is a method on an `RPCHost`, registered through a registry and served by whatever transport adapter the app wires up.

Most other civkit modules are `abstract class Abstract... extends AsyncService` classes that you subclass once per application, supplying the abstract properties (logger, config, container) via [tsyringe](https://github.com/microsoft/tsyringe) dependency injection.

Four ideas shape how these are used:

**Object-oriented style.** Civkit codebases use OOP more heavily than typical Node.js projects: everything is a class, composition happens through constructor injection and a DI container, inheritance is used freely, and decorators — many minted from service *instances* (`registry.decorators()`) — are a primary composition mechanism. Don't simplify toward free functions and plain objects; the class structure is the design.

**Rich domain models.** Data and the behavior governing it live in the same class: a session DTO carries `assertUser()`; an error carries its own response status; a record carries its projections. Nominal typing is the rule — casting goes through `Class.from(input)` at the boundary, and past it you hold a real instance. One `@Prop`-annotated class drives runtime coercion, OpenAPI documentation, wire serialization, DB diffing, and thread transfer.

**Managed lifecycle.** You don't sequence initialization by hand. Services declare dependencies (through constructor injection), and the toolkit initializes them lazily in dependency order; a service may degrade (`'crippled'`) instead of crashing and is revived on the next use. For users this just works — declare the dependency, await `serviceReady()`, done.

**A toolkit that grows out of projects.** Projects own their features; civkit exists to help. Patterns move from applications into the library once they prove stable and general. The abstract-class shape is the extraction seam — the library keeps the general half of a service, the application supplies the specific half in a thin subclass. Correspondingly, app-local infrastructure (task queues, ODMs for other stores, SSE codecs, custom registries) is normal: when you need something civkit doesn't have, build it in the project, in civkit's style.

## 2. AsyncService — services and lifecycle

`AsyncService` (`civkit/async-service`) is an `EventEmitter` with a readiness state machine:

```
'init' ──serviceReady()──▶ 'pending' ──emit('ready')──▶ 'ready'
                              │                            │
                          emit(error) ─▶ 'error'      emit('crippled') ─▶ 'crippled' (degraded; revivable)
                                                           │
                                                      standDown() ─▶ 'init'
```

The contract every subclass follows:

```ts
import { singleton } from 'tsyringe';
import { AsyncService } from 'civkit/async-service';

@singleton()
export class MyControl extends AsyncService {
    logger = this.globalLogger.child({ service: this.constructor.name });

    constructor(
        protected globalLogger: GlobalLogger,
        protected db: MongoDB,               // any AsyncService among ctor args
    ) {
        super(...arguments);                 // ← auto-registers AsyncService args as dependencies
    }

    override async init() {
        await this.dependencyReady();        // waits for every injected AsyncService
        // ... own setup ...
        this.emit('ready');                  // REQUIRED — flips status to 'ready'
    }
}
```

Key facts:

- **`super(...arguments)`**: the constructor scans its arguments and calls `dependsOn()` for every `AsyncService` found — constructor injection doubles as dependency-graph declaration. Omitting it fails silently: dependencies aren't tracked, `dependencyReady()` resolves early, and you get races against half-initialized services.
- **`serviceReady(): Promise<this>`** lazily kicks `init()` (on next tick) if the service is `'init'` or `'crippled'`, and resolves when `'ready'` fires. Idempotent while pending/ready. This is also the revive mechanism: a crippled service is re-initialized by the next `serviceReady()` call (the Koa adapter does this automatically per request).
- **`dependencyReady(timeoutMs = 30_000)`** is `Promise.all(deps.map(d => d.serviceReady()))` with retries; rejects with a `TimeoutError` naming the unready dependency classes — the first place to look when a server hangs on boot.
- **`emit('crippled')`** signals degradation without crashing (e.g. `AbstractMongoDB` cripples itself on connection errors and lets the next `serviceReady()` reconnect).
- **`standDown()`** suspends back to `'init'`; servers use it for graceful shutdown.
- Never `new` a service — resolve it from the tsyringe container so the singleton graph stays consistent.

`Defer()` from `civkit/defer` returns `{ promise, resolve, reject }` and appears throughout; `TimedDefer(ms)` auto-rejects with `TimeoutError`.

## 3. Coercible — data shapes

`Coercible` (from `civkit/civ-rpc`, `civkit/coercible`, or the root barrel) is the data-modeling core. `AutoCastable` is a legacy alias still found in older codebases; use `Coercible` in new code. Declare a class with `@Prop`, construct with `.from(input)`:

```ts
import { Coercible, Prop, Also } from 'civkit/civ-rpc';

enum ENGINE { BROWSER = 'browser', HTTP = 'http' }

@Also({ dictOf: Object })                    // class-level: tolerate & keep unknown extra keys
export class CrawlOptions extends Coercible {
    @Prop({ required: true, desc: 'Target URL' })
    url!: string;                            // type inferred from design:type metadata

    @Prop({ default: ENGINE.HTTP, type: ENGINE })   // plain enums auto-convert to Set membership checks
    engine!: ENGINE;

    @Prop({ arrayOf: String, validateCollection: (v) => v.length <= 10 })
    tags?: string[];

    @Prop({ path: 'x-timeout', type: Number, validate: (v) => v > 0 && v <= 180 })
    timeout?: number;                        // `path` reads a different input key (lodash deep paths ok)

    @Prop({ defaultFactory: () => new Date() })
    at!: Date;
}

const opts = CrawlOptions.from(rawInput);    // throws CoercionError (→ ParamValidationError in RPC) on bad input
```

What `@Prop` supports (`PropOptions`): `path` (input access path, string or symbol), `type` / `arrayOf` / `dictOf` (a constructor, a Coercible class, a `Set` or plain enum object for enum semantics, a zod schema — or an **array of these** for union types), `required`, `default`, `defaultFactory(obj)`, `nullable` / `memberNullable`, `validate(val, obj)` (return `boolean` or an `Error`; can be an array), `validateCollection`, `desc` / `markdown` / `deprecated` / `openapi` / `ext` (documentation metadata).

Coercion is real coercion, not just validation: `Number('42')`, boolean-ish strings (`'true' / '1'`), epoch seconds vs. milliseconds for `Date`, single value → `[value]` for `arrayOf`, `Buffer.from`, nested Coercible classes via their own `.from`, zod schemas via `safeParse` (duck-typed — zod is never a hard dependency).

**Type algebra** (from `civkit/civ-rpc` / `civkit/coercible`) — all return new Coercible classes usable anywhere a type is expected, including OpenAPI:

```ts
Combine(A, B)               // intersection/merge
Partial(A); Required(A); Pick(A, 'a', 'b'); Omit(A, 'secret')
Literal({ q: String, n: Number })            // anonymous DTO from a shape
ArrayOf(String, Thing); DictOf(Thing); OneOf(A, B, String)
```

Zod bridge (`civkit/coercible-zod`): `CastZod(zodSchema)` wraps a schema as a Coercible class; `toZod(CoercibleClass, z)` goes the other way.

**Inheritance works**: prop metadata is prototype-chained, so subclassing a DTO extends its fields.

The same system covers request DTOs, database document models, config records, rate-limit descriptors, and `ApplicationError` itself. Intended advanced use: override `static from(input)` to build objects that self-populate from their construction context (see auth in §9.4), inject services into instances via property injection, and put the domain's behavior on the class.

## 4. civ-rpc — methods, registries, transports

### 4.1 The mental model

- A **registry** (`AbstractRPCRegistry`, itself an AsyncService) owns a map of RPC method configs and mints decorators from its instance.
- A **host** (`RPCHost extends AsyncService`) is a class whose methods you decorate. The registry resolves the host from the DI container and invokes methods on it.
- **Adapters** bind registered methods to a transport. `KoaRPCRegistry` / `ExpressRegistry` serve HTTP; `AbstractThreadedServiceRegistry` executes in worker threads. The abstract registries carry no assumptions about the downstream transport or task; applications derive their own varieties — in-process call buses, CLI dispatchers, hosted-function bindings, LLM tool registries. Method code never touches the transport.

### 4.2 Registries and their decorators

A registry *instance* mints its decorators. The convention is to resolve each registry once and export its decorators from that module:

```ts
// src/services/registry.ts — the app's primary API registry
import { container, singleton } from 'tsyringe';
import { KoaRPCRegistry } from 'civkit/civ-rpc/koa';
import { IntegrityEnvelope } from 'civkit/civ-rpc';
import { propertyInjectorFactory } from 'civkit/property-injector';

@singleton()
export class RPCRegistry extends KoaRPCRegistry {
    container = container;
    logger = this.globalLogger.child({ service: this.constructor.name });
    static override envelope = IntegrityEnvelope;   // or your own envelope subclass
    override _BODY_PARSER_LIMIT = '50mb';

    constructor(
        protected globalLogger: GlobalLogger,
        protected tempFileManager: TempFileManager,
        protected ctxMgr: AsyncLocalContext,
    ) { super(...arguments); }
}

const instance = container.resolve(RPCRegistry);
export default instance;
export const { Method, RPCMethod, RPCReflect, Param, Ctx } = instance.decorators();
export const InjectProperty = propertyInjectorFactory(container);  // property injection for DTOs etc.
```

Two things to understand:

- **Apps commonly run several registries at once** — an HTTP API registry, a worker-thread registry, an in-process/LPC registry, a scheduler — each exporting its own decorator set (often renamed on export: `LPCMethod`, `Threaded`, `Recurred`). A method registers into whichever registry minted the decorator that adorns it.
- **Exporting decorators explicitly is for clarity and correctness**, not because anything else would break — decorators from a base registry generally work for subclasses. The explicit per-registry export makes it unambiguous which registry owns each method.

### 4.3 Defining endpoints

Endpoints live in `RPCHost` subclasses:

```ts
import { RPCHost, RPCReflection, RestParameters } from 'civkit/civ-rpc';
import { RPCMethod, Param, Ctx, RPCReflect } from '../services/registry';

@singleton()
export class CrawlerHost extends RPCHost {
    logger = this.globalLogger.child({ service: this.constructor.name });
    constructor(protected globalLogger: GlobalLogger, protected crawler: CrawlerControl) {
        super(...arguments);
    }
    override async init() { await this.dependencyReady(); this.emit('ready'); }

    @RPCMethod({
        name: 'crawl',                                   // default: method name
        proto: { http: { action: ['GET', 'POST'], path: '::url' } },  // default: POST /dotted/name + /rpc/dotted.name
        tags: ['crawl'],
        returnType: [RawString, PageDto],                // for OpenAPI
        throws: [SecurityCompromiseError, TimeoutError], // documented error responses
    })
    async crawl(
        @RPCReflect() rpcReflect: RPCReflection,   // per-call handle: signal, return(), then/catch/finally
        @Ctx() ctx: Context,                       // raw transport env (Koa ctx when served over Koa)
        auth: AuthDTO,                             // undecorated Coercible param → auto-cast from whole input
        options: CrawlOptions,                     //   (this is THE way to take structured input)
        @Param('url', { required: true }) url: string,   // scalar param by input key
        @Param({ validate: (v: number) => v > 0 }) count: number,  // path defaults to the parameter's name
        rest: RestParameters,                      // catches all input keys not otherwise consumed
    ) {
        // ... return a plain object / Coercible / string / Buffer / Readable ...
    }
}
```

How inputs bind:

- The adapter merges the transport's inputs into one joint input object (for HTTP: `{ ...query, ...body, ...pathParams }`) and stores the transport context under the `RPC_CALL_ENVIRONMENT` symbol.
- `@Param('key')` picks a single value; `@Ctx()` is sugar for `@Param(RPC_CALL_ENVIRONMENT)`; `@RPCReflect()` for `@Param(RPC_REFLECT)`.
- An **undecorated parameter typed as a Coercible class** is cast from the *whole* joint input (`Dto.from(jointInput)`), so DTOs can read anything — including the transport environment (see §9.4 Auth).
- An undecorated parameter with a **native type** binds by its *parameter name* (parsed from `fn.toString()`; use explicit `@Param('name')` if the code may be minified).
- Multiple stacked `@Param('count') @Param('num')` on one parameter create input-key aliases; multiple stacked `@Method` on one method create multiple routes; `name: ['my.userInfo', 'my.profile']` creates RPC-name aliases.
- Routes: `:seg` captures one path segment, `::rest` captures the remainder of the path.

`RPCReflection` — the per-call handle:

```ts
rpcReflect.signal          // AbortSignal — fires when the caller disconnects/aborts;
                           //   long handlers should check signal.aborted at expensive checkpoints
rpcReflect.return(stream)  // commit a response early (e.g. SSE stream) and keep working
rpcReflect.then((ret) => ...)     // post-success hook (billing, usage reporting)
rpcReflect.catch((err) => ...)    // error side-effects
rpcReflect.finally(() => ...)     // always
```

### 4.4 Wiring HTTP: KoaServer / ExpressServer

```ts
// src/stand-alone/server.ts
import 'reflect-metadata';
import { container, singleton } from 'tsyringe';
import { KoaServer } from 'civkit/civ-rpc/koa';

@singleton()
export class StandAloneServer extends KoaServer {
    title = 'my-app';
    constructor(
        protected globalLogger: GlobalLogger,
        protected registry: RPCRegistry,
        protected crawlerHost: CrawlerHost,      // every RPCHost injected = readiness dependency
        protected threads: ThreadedServiceRegistry,
    ) { super(...arguments); }

    override async registerRoutes() {
        this.koaApp.use(this.registry.makeShimController());   // ← mounts ALL registered RPC methods
    }
}

const instance = container.resolve(StandAloneServer);
export default instance;
if (require.main === module) {
    instance.serviceReady().then((s) => s.listen(Number(process.env.PORT) || 3000));
}
```

`KoaServer` provides: `/ping` health check, `/docs` (ReDoc page over the generated OpenAPI), request logging, trace-context middleware (override `insertAsyncHookMiddleware` to seed your `AsyncContext` per request), graceful shutdown in `standDown()`. The registry additionally serves **`/openapi.json`** (filterable: `?style=http|rpc&tags=...`), built entirely from `@Prop`/`@Method` metadata. `ExpressRegistry`/`ExpressServer` mirror the same shape for Express.

Output handling in the HTTP adapters: plain objects → enveloped JSON; `string` → text/plain; `Buffer` → content-type sniffed via libmagic; `Readable` → streamed (object-mode streams pass through `NDJsonStream`); `Blob` → attachment download. The registry emits `'run'` / `'ran'` / `'fail'` events per call — subscribe for telemetry/billing.

### 4.5 Registries beyond HTTP

Because registries are transport-free, a single codebase can serve the same registered methods over HTTP, a CLI (`app call <method>` resolves the registry and invokes by name), and an in-process local-procedure-call registry — with HTML pages and 302 redirects expressed as ordinary RPC return values carrying transfer-protocol metadata. Other derivations:

- **Worker threads**: `AbstractThreadedServiceRegistry` — see §8.
- **Hosted-function runtimes / schedulers**: registry varieties that map registered methods onto a platform's handler signatures with their own custom decorators, translating `ApplicationError` statuses into the platform's error space.
- **LLM tool-calling**: a private `AbstractRPCRegistry` + `OpenAPIManager.createRPCParametersSchemaObject()` turns `@Method` handlers into function-calling schemas.

## 5. Errors

`ApplicationError` (from `civkit/civ-rpc`) is a Coercible error with a 5-digit **extended status** convention: `status = protocol status × 100 + sub-code`; the 3-digit `code` (protocol-compatible; maps to the HTTP status when served over HTTP) derives automatically. E.g. `40001` ParamValidationError, `40103` AuthenticationRequired, `42901` TooManyRequests, `50001` ServerInternal.

Built-ins to throw instead of inventing your own: `ParamValidationError`, `AuthenticationRequiredError`, `AuthenticationFailedError`, `ResourceNotFoundError`, `OperationNotAllowedError`, `AssertionFailureError`, `TooManyRequestsError`, `DownstreamServiceError`, `InternalServerError`, `NotImplementedError`, `RequestPayloadTooLargeError`, …

Custom errors are one line:

```ts
import { ApplicationError, StatusCode } from 'civkit/civ-rpc';

@StatusCode(40202)   // extended status → protocol status 402, sub-code 02
export class InsufficientCreditsError extends ApplicationError {}
```

Throwing any `ApplicationError` sets the response status — the error carries its own transfer-protocol meta (§6), and whichever adapter is serving the call translates it. For header control, override the getter:

```ts
@StatusCode(42901)
export class RateLimitTriggeredError extends ApplicationError {
    @Prop() retryAfter?: number;
    override get [RPC_TRANSFER_PROTOCOL_META_SYMBOL]() {
        return { code: 429, headers: this.retryAfter ? { 'Retry-After': `${this.retryAfter}` } : {} };
    }
}
```

Collect error classes into catalogs (`export const CRAWLER_ERRORS = [...]`) and feed them to `@Method({ throws })` so OpenAPI documents them. When logging errors, use `marshalErrorLike(err)` (`civkit/lang`): `this.logger.warn('boom', { err: marshalErrorLike(err) })`.

## 6. The protocol layer: transfer-protocol meta and envelopes

Civ-rpc keeps application logic and protocol-level concepts separated. Methods return domain values and throw domain errors; status codes, headers, content types, and body wrapping are decided out-of-band — by metadata attached to values and by the registry's envelope. Write method code without assuming a transport: the same method may serve HTTP, an in-process bus, or a worker thread.

### 6.1 `RPC_MARSHAL` — a value's own wire representation

Define `[RPC_MARSHAL]()` on any object to control its serialized form (applied recursively on output). Typical use is redaction on a domain model:

```ts
override [RPC_MARSHAL]() { return _.omit(this, 'hashedToken'); }
```

### 6.2 Transfer-protocol meta (TPM) — per-value protocol instructions

`TransferProtocolMetadata` is `{ code?, status?, contentType?, headers?, envelope? }` — `status` is the 5-digit extended status, `code` the 3-digit protocol status; setting one derives the other (`status = code × 100`). Attach it to any value:

```ts
import { assignTransferProtocolMeta, RawString, RawBuffer, TPM } from 'civkit/civ-rpc';

return assignTransferProtocolMeta(markdownText, { contentType: 'text/markdown', envelope: null });
assignTransferProtocolMeta(result, { code: 202 });          // "accepted" for async processing
@TPM({ code: 202 }) class TaskAccepted extends Task {}      // class-level: every instance carries it
```

`RawString` / `RawBuffer` are pre-declared `@TPM({ envelope: null, contentType: ... })` classes — return one to bypass wrapping entirely. Errors participate through the same mechanism: `ApplicationError`'s TPM getter is what sets the response status (§5), and a `RedirectionDto` whose getter yields `{ code: 302, headers: { Location } }` makes a redirect an ordinary return value.

### 6.3 Envelopes — the response wrapper, chosen per call

An **envelope** decides the final shape of every response. The `RPCEnvelope` contract:

- `wrap(data, meta?) → { tpm, output }` — wrap a successful result;
- `wrapError(err) → { tpm, output }` — wrap a failure;
- `describeWrap(rpcOptions)` — rewrite the method's declared return type so OpenAPI documents the *wrapped* schema.

**`IntegrityEnvelope`** is the standard production envelope: it wraps results as `{ code, status, data, meta }` (code = protocol status, status = extended status — `200`/`20000` on success), guarantees errors serialize as `{ code, status, message }` (falling back to `500`/`50000`), and **passes streams, Buffers, and Blobs through unwrapped** so binary/streaming endpoints keep working under an enveloped registry. Populate the `meta` field from inside a method with `assignMeta(result, {...})`.

Subclass an envelope for content negotiation — e.g. one that inspects `Accept` and renders errors as JSON, plain text, or SSE events accordingly.

**Resolution order** (per call): explicit override passed to `registry.call()` → per-method `@Method({ envelope })` → an `envelope` set in the returned value's TPM → the registry's `static envelope`.

**Suppression paths** — three ways to say "no envelope":

1. Per value: `assignTransferProtocolMeta(x, { envelope: null, ... })`;
2. Per type: return a `RawString`/`RawBuffer`, or `@TPM({ envelope: null })` on your own class;
3. Per method: `@Method({ envelope: null })` for endpoints that are always raw (webhooks, HTML pages, file downloads).

### 6.4 Streaming

Return a `Readable` (object-mode → NDJSON over HTTP), or build an output Transform stream (civkit ships the low-level pieces: `EventStream` in `civkit/event-stream`, `NDJsonStream` in `civkit/nd-json`; richer SSE codecs are typically app-local code) and commit it early:

```ts
const sse = new MySSEOutputStream();          // an app-local Transform emitting text/event-stream
rpcReflect.return(sse);                       // response starts now
rpcReflect.catch((err) => { sse.write({ event: 'error', data: ... }); sse.end(); });
// keep writing to sse asynchronously...
```

## 7. Async context

`civkit/async-context` provides request-scoped implicit state (thread-local style), built on `AsyncLocalStorage` and wrapped as a service — something average Node projects don't have.

Subclass once (`class AsyncLocalContext extends GlobalAsyncContext {}`), inject it anywhere. The API:

- `ctx` / `get(k)` / `set(k, v)` — read/write the current call's context from any depth of the call graph, no parameter drilling;
- `run(fn, base?)` / `setup(base?)` — establish a context (adapters run every RPC call inside `ctxMgr.run(...)` with the transport env as the context's prototype);
- `bridged(fn)` / `bridge(ctx, fn)` — carry the context across callback boundaries the async hooks can't track (event emitters, queues);
- `fork(...)` / `forked(...)` — spawn a prototype-chained *child* context: reads fall through to the parent, writes stay local.

Trace propagation is built in: `setupTraceId()`, `parseTraceparent00()` (W3C traceparent), `getTraceCtx()` / `getTraceId()` — and `AbstractLogger` automatically stamps `traceId`/`traceDt` onto every log line.

What typically rides on the context: the trace id, the authenticated uid (set by the auth DTO inside `.from()`/`assertUser()`, read later by billing), request-scoped flags, and cooperative cancellation (`civkit/async-kill` builds on it — note that module replaces `globalThis.Promise` at import time, so import it deliberately). The context is also **serialized across worker-thread calls** (§8), so a `@Threaded` method sees its caller's trace and identity.

## 8. Multithreading

Civkit makes `worker_threads` usable as ordinary method calls — no hand-rolled `postMessage` protocols, and none of structured clone's limitations:

```ts
@Threaded()          // minted from the app's threaded registry instance
async renderChart(data: ChartData) { ... }   // call it normally; it runs in a worker
```

Two components:

- **`AbstractThreadedServiceRegistry`** (`civkit/threaded`) — a civ-rpc registry whose methods execute in a worker pool. Calls route to the least-loaded worker; the pool grows on demand and clears idle workers. `@MainThread()` is the inverse — code already in a worker calls back into the main thread. `AbortSignal` propagates across the boundary, and the async context (§7) ships along.
- **`AbstractPseudoTransfer`** (`civkit/pseudo-transfer`) — the enabling layer. Structured clone only moves plain data; pseudo-transfer extends it to **functions, promises, event emitters, async iterators, and registered custom classes** by walking the value graph and creating remote proxies wired over dedicated `MessageChannel` ports: a method call, a `.then()`, an event subscription, or a `next()` on the other side round-trips transparently. Ports are cleaned up via `Symbol.dispose` and `FinalizationRegistry`.

Setup (once per app): subclass both abstracts, export `const { Threaded } = threadedRegistry.decorators()`, and make the threaded registry a dependency of your server. Workers bootstrap themselves by re-importing the app's config module. One rule to remember: **custom classes that cross the boundary — errors above all — must be registered** with `pseudoTransfer.expectPseudoTransferableType(MyErrorClass)`, or they arrive as plain objects.

## 9. Application architecture

These conventions emerged in the applications civkit was extracted from; treat them as the house style. Two layout variants exist:

```
# Flat layout (smaller apps, one domain):
src/
├── stand-alone/          # entry points; one KoaServer subclass per deployment target
├── api/                  # RPCHost subclasses — the endpoint surface (+ error catalogs)
├── services/             # one @singleton() AsyncService per capability; thin subclasses
│                         #   of civkit abstracts: registry, logger, finalizer, threaded,
│                         #   pseudo-transfer, temp-file, mongodb, bucket, async-context
├── dto/                  # Coercible request DTOs (options, auth)
├── db/                   # Coercible document models + one collection singleton per file
├── 3rd-party/            # HTTPService subclasses (one per external API)
├── lib/                  # framework-free helpers
└── utils/                # pure functions

# Modular layout (larger apps, many domains):
src/
├── server.ts / watcher.ts / cli.ts   # peer entry points (HTTP server, cron daemon, CLI)
├── services/             # domain-AGNOSTIC infrastructure (registry, logger, mongo, smtp,
│                         #   x509, temp, object-storage, task-queue, scheduler, ...)
├── modules/<domain>/     # one mini-app per business domain, each with a fixed shape:
│   ├── api/              #   RPCHosts (auto-discovered; env-flag to disable a module)
│   ├── control/          #   business services ("FooControl")
│   ├── dto/              #   domain DTOs (e.g. the session/auth DTOs)
│   └── mongo/            #   records + collections
└── db/mongo/             # cross-domain collections (mq, live-config, pubsub, ...)
```

### 9.1 The universal idioms

- **File-bottom singleton export** (everywhere):
  ```ts
  const instance = container.resolve(MyService);
  export default instance;
  // registry-like services additionally export their minted decorators:
  export const { Finalizer } = instance.decorators();
  ```
- **Bootstrap order**: `import 'reflect-metadata'` → config module (which may `container.registerSingleton(Abstract, Concrete)` to swap implementations by env) → `container.resolve(Server)` → `await serviceReady()` → `listen()`.
- **Dry-run mode**: `NODE_ENV=dry-run` resolves the whole DI graph then exits via the finalizer — used to smoke-test wiring and warm compile caches in Docker builds.
- **Endpoint auto-discovery** (optional): scan `api/` at startup and collect every export whose `prototype instanceof RPCHost`; injecting hosts into the server constructor achieves the same with static wiring.
- **Deployment variants**: multiple entry points share one codebase; each entry injects only the hosts it serves (and can even delete registry entries by tag at init).

### 9.2 Logger

Subclass `AbstractPinoLogger` (`civkit/pino-logger`) once as `GlobalLogger`; every other class opens with:

```ts
logger = this.globalLogger.child({ service: this.constructor.name });
```

The base logger auto-appends `traceId` from the async context (§7); wire your platform's trace-correlation fields in the subclass.

### 9.3 Request context

Subclass `GlobalAsyncContext` once and seed it per request (override `insertAsyncHookMiddleware` on the server, or set up trace ctx in your own middleware). See §7 for the rest.

### 9.4 Auth — a DTO, not a middleware

Civkit ships no auth facility. Auth is application code — the intended advanced use of `Coercible`: model the session as a domain object rather than a middleware chain. The DTO's `static from(input)` reads the transport env; services arrive by property injection; the authorization surface is methods:

```ts
export class AuthDTO extends Coercible {
    @InjectProperty(AsyncContext) ctxMgr!: AsyncContext;   // property injection into a non-DI class

    static override from(input: any) {
        const instance = super.from(input) as AuthDTO;
        const ctx = Reflect.get(input, RPC_CALL_ENVIRONMENT);   // the transport env
        instance.bearerToken = ctx?.get('authorization')?.replace(/^Bearer /i, '');
        return instance;
    }

    async assertUID(): Promise<string> {
        if (!this.bearerToken) throw new AuthenticationRequiredError('...');
        // verify, cache, this.ctxMgr.set('uid', uid), return uid
    }
}
```

Every authenticated endpoint declares `auth: AuthDTO` and calls `await auth.assertUID()`. Subclasses can layer further checks (captcha, security inspection) on top.

### 9.5 Persistence

- **Mongo** (`civkit/abstract/mongo`): subclass `AbstractMongoDB` once (it auto-cripples on connection errors); then one `AbstractMongoCollection<T>` subclass per collection declaring `collectionName`, `typeclass` (a Coercible model), `indexes`, and `@InjectProperty() mongo!: MongoDB` (the base class wires `dependsOn(this.mongo)` from the prototype property). You get typed CRUD (`get/create/set/save/upsertOne/...` — `set` uses BSON-aware dotted-path `$set` diffs via `vectorize2`), `withTransaction` (bounded retries, unlike the driver's), change streams (`subscribe`), and capped-collection tailing. Civ-mongo is in the box partly for convenience and partly as a reference example of composing the primitives — worth reading before building your own store integration.
- **Anything else**: model documents as Coercible classes regardless of store, and build a thin project-owned ODM in the same style — e.g. a `Record extends Coercible` base with `static collectionName`, typed loaders, `save()`, and `[RPC_MARSHAL]` for wire redaction.
- **Rich collections**: collection classes carry behavior too, not just CRUD. A message-queue collection can implement queue semantics (`enqueueOne`, atomic lease-based `pickOne`, `acknowledgeOne`) as methods; a live-config collection can double as a config bus (change streams + per-key emitters) and mint a distributed `@lock` method decorator from itself. Translate driver errors into domain errors at this layer (e.g. Mongo duplicate-key 11000 → a domain `...OccupiedError`).

### 9.6 External HTTP APIs

One `HTTPService` (`civkit/http`) subclass per vendor:

```ts
export class OpenAICompat extends HTTPService {
    constructor(baseUri: string, protected apiKey: string) {
        super(baseUri);
        this.baseHeaders['Authorization'] = `Bearer ${apiKey}`;
        this.baseOptions.timeout = 30_000;
    }
    chat(payload: object) {
        return this.postJson<ChatResponse>('/chat/completions', payload,
            { responseType: (payload as any).stream ? 'stream' : 'json' });
    }
}
```

Requests return `Response & { data: T }` promises with `.cancel()`; failures throw `HTTPServiceError` carrying status, config, and response.

### 9.7 CPU-heavy work

Goes through `@Threaded()` — not hand-rolled `worker_threads`/`postMessage`. See §8.

### 9.8 Graceful shutdown & temp files

- `AbstractFinalizerService` (`civkit/finalizer`): hooks SIGTERM/SIGINT/uncaught; export `const { Finalizer } = instance.decorators()` and decorate `standDown()` methods with `@Finalizer()` to register teardown in reverse order.
- `AbstractTempFileManger` (`civkit/temp`): `alloc()` a path, or `cacheReadable()/cacheBuffer()` to get a GC-bound `FancyFile`; `bindPathTo(obj, path)` ties a temp file's lifetime to any object. Everything is swept on exit.
- `FancyFile` (`civkit/fancy-file`): lazy file handle where mime/size/sha256/path are promise-valued and computed on demand; `FancyFile.auto(x)` accepts paths, URLs, Buffers, streams, Blobs. It's also the type of multipart upload params and integrates with object storage and temp management.

## 10. Infrastructure services catalog

Each is an `abstract class ... extends AsyncService`; subclass once, supply abstract props (usually `logger`, config, `container`), resolve as a singleton.

| Module | Class | Purpose |
|---|---|---|
| `civkit/civ-rpc/koa` | `KoaRPCRegistry`, `KoaServer` | HTTP transport (trie router, multipart→FancyFile, NDJSON/stream output, OpenAPI, ReDoc) |
| `civkit/civ-rpc/express` | `ExpressRegistry`, `ExpressServer` | Express flavor of the same |
| `civkit/pino-logger` | `AbstractPinoLogger` | pino-backed structured logger with trace correlation |
| `civkit/async-context` | `AbstractAsyncContext`, `GlobalAsyncContext` | AsyncLocalStorage request/trace context (§7) |
| `civkit/finalizer` | `AbstractFinalizerService` | graceful shutdown; `@Finalizer()` decorator |
| `civkit/temp` | `AbstractTempFileManger` | GC- and exit-safe temp files |
| `civkit/file-storage` | `AbstractStorageManager` | local scattered-path file store |
| `civkit/threaded` | `AbstractThreadedServiceRegistry` | worker-thread RPC pool; `@Threaded()` (§8) |
| `civkit/pseudo-transfer` | `AbstractPseudoTransfer` | rich object marshalling across threads (§8) |
| `civkit/schedule` | `AbstractScheduleService` | node-schedule wrapper; `@Recurred()` decorator |
| `civkit/signal-bus` | `AbstractSignalBus` | named-signal dispatch (parallel/serial/reverse) |
| `civkit/abstract/mongo` | `AbstractMongoDB`, `AbstractMongoCollection`, `AbstractMongoCappedCollection` | typed Mongo with cripple/revive |
| `civkit/abstract/object-storage` | `AbstractObjectStorageService` | minio/S3; FancyFile-aware; presigned URLs |
| `civkit/abstract/smtp` | `AbstractSMTPSenderService`, `AbstractSMTPReceiverService` | outbound (incl. direct-to-MX) and inbound mail |
| `civkit/x509` | `AbstractX509Manager`, `AbstractX509CertificateAuthority` | cert loading/watching, self-signed CA |
| `civkit/http` | `HTTPService` | fetch-based API client base (not an AsyncService) |
| `civkit/sub-process` (+`civkit/abstract/sub-process`) | `SubProcessRoutine`, `AbstractSubProcess` | promise-wrapped spawn with timeout/line events |

## 11. Method decorators

From `civkit/decorators` (or root barrel). All are per-instance unless noted:

| Decorator | Semantics |
|---|---|
| `@retry(maxTries, delayMs?)` | retry on rejection; prior errors attached under `TRIES_SYMBOL` |
| `@retryWith(customizer, maxTries, delayMs?)` | customizer inspects each error; `false` vetoes further retries |
| `@throttle(waitMs)` | leading-edge: calls within the window get the previous call's promise |
| `@debounce(waitMs, maxWait?)` | trailing-edge: burst callers share one deferred result |
| `@maxConcurrency(cap)` | over-cap calls **don't queue** — they get an in-flight call's promise |
| `@serialOperation(sym?)` / `@globalSerialOperation(sym?)` | serialize calls per instance / globally; share a symbol to share a lane |
| `@perTick()` | at most one real run per event-loop tick (others get cached result) |
| `@perNextTick()` | coalesce: schedule one run next tick, return `undefined` (fire-and-forget) |
| `@runOnce()` | memoize-forever per instance (result or error) |
| `@indefiniteLoop(concurrency?, terminator?)` | self-restarting loop until the method returns `terminator` |

`patchRetry(fn, tries, delay?)` is the plain-function form of `@retry`.

## 12. Utility catalog

The most-used pure helpers (import path → names):

- `civkit/lang` — **`marshalErrorLike(err)`** (error → plain object; the standard for logging), `stringifyErrorLike`, prototype-chain walkers, `parseUrl`.
- `civkit/timeout` — `delay(ms)`, `timeout(promise, ttl)`.
- `civkit/defer` — `Defer()`, `TimedDefer(ms)`, `TimeoutError`.
- `civkit/hash` — `HashManager` (`hash`, `hashStream`), `HMacManager`, `SaltedHashManager`, `objHashMd5B64Of(obj)` (stable object hash).
- `civkit/mime` — `mimeOf(bufferOrPath)`, `mimeOfExt`, `extOfMime`, `detectBuff`, `parseContentType`.
- `civkit/encoding` — `detectEncoding`, `decode` (jschardet + iconv-lite).
- `civkit/random` — `randomPick(set)`, `randomInt`, `randomMultiPick`.
- `civkit/vectorize` — `vectorize2` (dotted-path flatten; powers Mongo `$set`), `deepClone`, `deepClean`, `parseJSONText`.
- `civkit/defuse` — `defuse(promise)` (never rejects), `awaitObj(obj)` (await all promise props).
- `civkit/event-stream` — `EventStream` (object-mode → SSE framing).
- `civkit/nd-json` — `NDJsonStream` / `NDJsonDecodeStream`.
- `civkit/json-parser-stream` — `JSONParserStream` / `JSONAccumulation`: incremental, damage-tolerant JSON parsing (built for LLM output; handles JSON embedded in prose, truncated input).
- `civkit/fswalk` — `FsWalk.walk/walkOut` (recursive dir walker; handy for static file serving).
- `civkit/trie-router` / `civkit/trie` — `TrieRouter`, `TrieNode`.
- `civkit/download` — `downloadFile(uri, dest)`.
- `civkit/readability` — `humanReadableDataSize`.
- `civkit/escape` — `htmlEscape` tagged template.
- `civkit/change-case`, `civkit/yaml`, `civkit/base32`, `civkit/which`, `civkit/gtld`, `civkit/path`, `civkit/file-system`, `civkit/watch-tailer` (tail -F), `civkit/cryptology` (simple AES-256), `civkit/custom-lookup` (custom DNS), `civkit/sub-emitter`, `civkit/property-injector`.

## 13. Environment setup

Civkit uses TypeScript decorators with emitted design-time type metadata. Required in every consumer:

```jsonc
// tsconfig.json
{
    "compilerOptions": {
        "experimentalDecorators": true,
        "emitDecoratorMetadata": true,     // design:type / design:paramtypes power @Prop and @Param inference
        "useDefineForClassFields": false,  // class fields must not shadow prototype-installed accessors
        "target": "es2022",
        "module": "commonjs"
    }
}
```

Do not switch a civkit codebase to TC39-style decorators: they do not emit the `design:paramtypes` / `design:type` reflect-metadata civkit reads. Note that a missing `emitDecoratorMetadata` degrades quietly (types fall back to `Object`, params misbind) rather than failing loudly.

Runtime:

```ts
// The very first import of your entry point:
import 'reflect-metadata';
```

- `tsyringe` is a **peer dependency** — install it yourself.
- Heavy integrations (`koa`, `express`, `mongodb`, `minio`, `pino`, `nodemailer`, `zod`, `libmagic-ffi`, …) are **optionalDependencies** — install the ones the modules you use need.
- Node >= 18.

**Import style.** The package ships a subpath export map. The root barrel (`import { ... } from 'civkit'`) covers decorators/lib/utils/civ-rpc; deep imports (`civkit/async-service`, `civkit/civ-rpc`, `civkit/defer`, …) are preferred for new code. Deep-import only (not in the root barrel): `civkit/civ-rpc/koa`, `civkit/civ-rpc/express`, `civkit/abstract/mongo`, `civkit/abstract/object-storage`, `civkit/abstract/smtp`, `civkit/pino-logger`, `civkit/threaded`, `civkit/pseudo-transfer`, `civkit/finalizer`, `civkit/schedule`, `civkit/async-context`, `civkit/property-injector`, and several utils (`civkit/trie`, `civkit/change-case`, `civkit/yaml`, …).

**Older codebases** (civkit 0.9.x): HTTP routing declared as `@Method({ ext: { http } })` (0.10.x prefers `proto: { http }`; adapters read both), serialization via `toJSON()`-style methods rather than `[RPC_MARSHAL]`, and the `AutoCastable` name for `Coercible`.

---

*Quick start for a new app, in order: tsconfig flags → `reflect-metadata` → `GlobalLogger` → `AsyncContext` → `FinalizerService` → `TempFileManager` → `RPCRegistry` (export decorators) → your first `RPCHost` in `api/` → `StandAloneServer extends KoaServer` → `container.resolve(...).serviceReady().then(s => s.listen(port))`. Check `/ping`, `/docs`, and `/openapi.json`.*
