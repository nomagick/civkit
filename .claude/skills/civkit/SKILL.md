---
name: civkit
description: Conventions and recipes for building on civkit — the AsyncService/Coercible/civ-rpc TypeScript backend toolkit. Use when writing or modifying code in civkit itself or any project that depends on civkit (RPCHost endpoints, AsyncService services, Coercible DTOs, KoaServer/registry wiring, ApplicationError subclasses, @Threaded workers, AbstractMongoCollection, HTTPService clients).
---

# Working with civkit

## The mental model

- **Stateful component / capability** → `AsyncService` subclass, `@singleton()`, resolved from the tsyringe container.
- **Data shape** (request DTO, DB record, config, error payload) → `Coercible` class with `@Prop`; `.from(input)` coerces untrusted input into a real instance. (`AutoCastable` is a legacy alias — use `Coercible` in new code.)
- **Callable operation** → method on an `RPCHost`, decorated with `@RPCMethod` from one of the app's registry modules; transport is the registry's concern, not the method's.

Principles:

- **Civkit is a toolkit that serves projects.** Features belong to the project; patterns are extracted into civkit once stable and general. When a capability is missing, build it in the project, in civkit's style. Its absence from civkit is not a defect; don't push project code into civkit prematurely.
- **OOP style.** Classes, inheritance, DI-resolved singletons, decorators minted from service instances. Don't "simplify" toward free functions, plain objects, or duck typing — nominal classes and `instanceof` are meaningful here.
- **Rich domain models.** Data and its governing behavior live in the same class: auth is a session DTO with `assertUser()` methods (application code, not a civkit facility, not middleware); errors carry their own status/headers; records carry projections. One `@Prop`-annotated class drives validation, OpenAPI, wire format, DB diffing, and thread transfer. Don't write a bare-record type plus helper functions when a method on the model would do.
- **Application logic and protocol-level concepts are separate — don't assume HTTP.** Methods return domain values and throw domain errors; status, headers, content type, and wrapping ride out-of-band (transfer-protocol meta + envelopes), applied by whichever adapter serves the call.
- **Managed lifecycle.** Declare dependencies via constructor injection; the toolkit initializes lazily in dependency order, degrades (`'crippled'`) instead of crashing, and revives on the next `serviceReady()`. Don't sequence initialization by hand.

For full API details read `GUIDE.md` at the civkit repo root (also usable from `node_modules/civkit` sources).

## Hard rules

1. Every `AsyncService` constructor ends with `super(...arguments)` (that's how injected services become lifecycle dependencies), and every `init()` ends with `this.emit('ready')` after `await this.dependencyReady()`. Missing `emit('ready')` fails loudly (TimeoutError); missing `super(...arguments)` fails silently with init races.
2. Never `new` a service — `container.resolve(X)`. File-bottom idiom: `const instance = container.resolve(X); export default instance;` and for registry-like services also `export const { ... } = instance.decorators();`.
3. RPC decorators (`Method`/`RPCMethod`/`Param`/`Ctx`/`RPCReflect`), `@Finalizer`, `@Threaded`, `@Recurred` are minted from **registry instances**. Apps often run several registries (HTTP API, threaded, in-process, scheduler) — import each decorator from the module of the registry that should own the method. The explicit exports are for clarity and correctness about ownership (base-registry decorators generally work for subclasses).
4. Throw `ApplicationError` subclasses (from `civkit/civ-rpc`), never bare `Error`, in request paths. Custom error = `@StatusCode(NNNNN) class X extends ApplicationError {}` — a 5-digit extended status (`protocol status × 100 + subcode`); the response status follows automatically through whatever adapter serves the call.
5. Log errors as `{ err: marshalErrorLike(err) }` (`civkit/lang`). Every class opens with `logger = this.globalLogger.child({ service: this.constructor.name });`.
6. CPU-heavy work goes through `@Threaded()` (threaded registry + pseudo-transfer), not raw `worker_threads`/`postMessage`. Register custom error classes crossing the boundary: `pseudoTransfer.expectPseudoTransferableType(ErrClass)`.
7. Request-scoped state goes on the async context (`civkit/async-context`), not on parameters threaded through every call: `ctxMgr.get/set` anywhere, `bridged(fn)` across untracked callbacks. Trace ids propagate automatically into logs, and the context ships across `@Threaded` calls.
8. Prefer deep imports (`civkit/async-service`, `civkit/civ-rpc`, `civkit/defer`, ...). Adapters and abstracts are deep-import only: `civkit/civ-rpc/koa`, `civkit/abstract/mongo`, `civkit/pino-logger`, `civkit/threaded`, `civkit/finalizer`, `civkit/temp`, `civkit/async-context`, `civkit/property-injector`.
9. Environment: consumer tsconfig has `experimentalDecorators: true`, `emitDecoratorMetadata: true`, `useDefineForClassFields: false` (TypeScript decorators; TC39-style decorators lack the metadata civkit reads). Entry point starts with `import 'reflect-metadata'`. `tsyringe` is a peer dependency.

## Recipe: service

```ts
import { singleton } from 'tsyringe';
import { AsyncService } from 'civkit/async-service';

@singleton()
export class FooControl extends AsyncService {
    logger = this.globalLogger.child({ service: this.constructor.name });
    constructor(protected globalLogger: GlobalLogger, protected bar: BarControl) {
        super(...arguments);
    }
    override async init() {
        await this.dependencyReady();
        this.emit('ready');
    }
}
```

Callers await `fooControl.serviceReady()` (lazy init + revive-from-'crippled'). Degrade without crashing via `this.emit('crippled')`; suspend via `standDown()`.

## Recipe: DTO

```ts
import { Coercible, Prop, Also } from 'civkit/civ-rpc';

@Also({ dictOf: Object })                       // keep unknown extra keys
export class CrawlOptions extends Coercible {
    @Prop({ required: true, desc: 'Target URL' }) url!: string;
    @Prop({ default: 'http', type: ENGINE_ENUM }) engine!: string;   // enums/Sets = membership check
    @Prop({ arrayOf: String, validateCollection: (v) => v.length <= 10 }) tags?: string[];
    @Prop({ path: 'x-timeout', type: Number, validate: (v) => v > 0 }) timeout?: number;
}
const o = CrawlOptions.from(input);             // coerces + validates; throws CoercionError
```

`type`/`arrayOf`/`dictOf` accept constructors, Coercible classes, Sets/enums, zod schemas, or arrays of these (unions). Type algebra: `Combine`, `Partial`, `Required`, `Pick`, `Omit`, `Literal`, `ArrayOf`, `DictOf`, `OneOf`. Advanced (intended) use: override `static from(input)` and read `Reflect.get(input, RPC_CALL_ENVIRONMENT)` to self-populate from the transport context (headers, auth); `@InjectProperty()` services into instances. Control wire output with `[RPC_MARSHAL]() { return _.omit(this, 'secret'); }`.

## Recipe: RPC endpoint

```ts
import { RPCHost, RPCReflection, RestParameters } from 'civkit/civ-rpc';
import { RPCMethod, Param, Ctx, RPCReflect } from '../services/registry';  // the registry that owns this method

@singleton()
export class FooHost extends RPCHost {
    // ...standard service skeleton...

    @RPCMethod({
        proto: { http: { action: ['GET', 'POST'], path: '/foo/:id' } },  // default: POST /class/method
        tags: ['foo'], returnType: FooDto, throws: [ResourceNotFoundError],
    })
    async getFoo(
        @RPCReflect() rpcReflect: RPCReflection,  // .signal (caller abort), .return(x), .then/.catch/.finally
        @Ctx() ctx: Context,                      // raw transport env
        auth: AuthDTO,                            // undecorated Coercible param = auto-cast from joint input
        @Param('id', { required: true }) id: string,
        rest: RestParameters,                     // catches unconsumed input keys
    ) {
        await auth.assertUID();
        return foo;                               // domain value; the envelope/adapter decides the wire shape
    }
}
```

Input = the transport's merged joint input (for HTTP: `{ ...query, ...body, ...pathParams }`). Stacked `@Param('a') @Param('b')` = key aliases; stacked `@Method` = multiple routes; `name: ['a.b', 'a.c']` = RPC-name aliases; `::rest` = catch-all path segment. Long handlers should check `rpcReflect.signal.aborted` at expensive checkpoints.

## Protocol layer (envelopes + TPM)

- Registry's `static envelope` wraps every result. `IntegrityEnvelope` (the standard) → `{ code, status, data, meta }`; errors are guaranteed `{ code, status, message }`; streams/Buffers/Blobs pass through unwrapped. Add envelope `meta` from a method via `assignMeta(result, {...})`. Subclass the envelope for content negotiation (JSON vs text vs SSE by `Accept`).
- Per-value protocol instructions: `assignTransferProtocolMeta(value, { code, contentType, headers, envelope })`. Errors do this implicitly (`@StatusCode`); a redirect DTO can carry `{ code: 302, headers: { Location } }`.
- **Envelope suppression** (raw responses): per value `assignTransferProtocolMeta(x, { envelope: null })`; per type `RawString`/`RawBuffer` or `@TPM({ envelope: null })`; per method `@Method({ envelope: null })`.
- Resolution order: call-time override → per-method `envelope` option → returned value's TPM → registry static.
- Streaming/SSE: build an output stream, `rpcReflect.return(stream)` early, handle errors in `rpcReflect.catch`. Billing/usage: `rpcReflect.then/finally`.

## Recipe: registry + server

```ts
// services/registry.ts — one module per registry; apps may have several (HTTP, threaded, LPC, ...)
@singleton()
export class RPCRegistry extends KoaRPCRegistry {        // civkit/civ-rpc/koa
    container = container;
    static override envelope = IntegrityEnvelope;        // or a custom envelope subclass
    // abstract deps: logger, tempFileManager, ctxMgr — inject via constructor
}
const instance = container.resolve(RPCRegistry);
export default instance;
export const { Method, RPCMethod, RPCReflect, Param, Ctx } = instance.decorators();
export const InjectProperty = propertyInjectorFactory(container);   // civkit/property-injector

// stand-alone/server.ts
@singleton()
export class Server extends KoaServer {
    constructor(..., protected registry: RPCRegistry, protected fooHost: FooHost) { super(...arguments); }
    override registerRoutes() { this.koaApp.use(this.registry.makeShimController()); }
}
container.resolve(Server).serviceReady().then((s) => s.listen(PORT));
```

`KoaServer` provides `/ping`, `/docs` (ReDoc), `/openapi.json` (generated from `@Prop`/`@Method` metadata). The registry emits `'run'`/`'ran'`/`'fail'` per call — hook for telemetry. The abstract registries carry no transport assumptions; apps derive their own varieties (in-process buses, CLI dispatch, hosted-function bindings, LLM tool schemas). `NODE_ENV=dry-run` bootstrap (resolve the DI graph, then exit via the finalizer) is the standard wiring smoke test.

## Recipe: threaded method

```ts
// services/threaded.ts — once per app: subclass AbstractThreadedServiceRegistry + AbstractPseudoTransfer
export const { Threaded } = threadedRegistry.decorators();

// anywhere:
@Threaded()
async heavyTransform(input: Payload) { ... }   // runs in the worker pool; call it normally
```

Pseudo-transfer extends structured clone with remote proxies for functions, promises, event emitters, async iterators, and registered classes — and the async context (trace, uid) ships across. `@MainThread()` calls back from worker to main. Use this instead of manual worker plumbing.

## Recipe: mongo collection

```ts
// services/mongodb.ts — once
@singleton() export class MongoDB extends AbstractMongoDB { /* url, options, logger; emit('ready') */ }

// db/mongo/foo.ts — per collection
@singleton()
export class FooCollection extends AbstractMongoCollection<FooDoc> {   // civkit/abstract/mongo
    collectionName = 'foos';
    typeclass = FooDoc;                       // a Coercible model
    indexes: this['indexes'] = [['uidCreated', { uid: 1, createdAt: -1 }]];
    @InjectProperty() mongo!: MongoDB;        // prototype prop → auto dependsOn
}
```

Use `get/create/set/save/upsertOne/...` (`set` does BSON-aware dotted `$set` diffs) and civkit's `withTransaction` (bounded retries — not the driver's). Civ-mongo also serves as a reference example of composing the primitives — mirror its style when integrating other stores.

## Cheat sheet: method decorators (`civkit/decorators`)

`@retry(n, ms?)` · `@retryWith(pred, n, ms?)` · `@throttle(ms)` (leading-edge, shares last promise) · `@debounce(ms, max?)` · `@maxConcurrency(n)` (**drops to an in-flight promise, does not queue**) · `@serialOperation()` · `@perTick()` · `@perNextTick()` (coalesce, returns `undefined`) · `@runOnce()` (memoize forever) · `@indefiniteLoop()`.

## Older codebases (civkit 0.9.x)

HTTP routing as `@Method({ ext: { http } })` (0.10.x prefers `proto: { http }`; adapters read both), serialization via `toJSON()`-style methods rather than `[RPC_MARSHAL]`, and the `AutoCastable` name for `Coercible`.
