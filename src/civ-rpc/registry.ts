import { RPCEnvelope, RPCHost, RPC_CALL_ENVIRONMENT, RPC_REFLECT } from './base';
import { AsyncService } from '../lib/async-service';
import { Defer } from '../lib/defer';
import {
    RPCMethodNotFoundError,
    ParamValidationError,
    ApplicationError,
} from './errors';
import type { container as DIContainer } from 'tsyringe';
import {
    AutoCastingError,
    inputSingle, isAutoCastableClass, PropOptions, __patchPropOptionsEnumToSet
} from '../lib/auto-castable';
import { RestParameters, shallowDetectRestParametersKeys } from './magic';
import { extractMeta, extractTransferProtocolMeta, TransferProtocolMetadata } from './meta';
import { get } from 'lodash';
import { NATIVE_CLASS_PROTOTYPES } from '../utils/lang';

const NOTHING = Symbol('NOTHING');

const REMOVE_COMMENTS_REGEXP = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/gm;
export function getParamNames(func: Function): string[] {
    const fnStr = func.toString().replace(REMOVE_COMMENTS_REGEXP, '');
    const result = fnStr
        .slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')'))
        .split(',')
        .map(content => {
            return content.trim().replace(/\s?=.*$/, '');
        })
        .filter(Boolean);

    return result;
}

export interface RPCOptions {
    name: string | string[];
    returnType?: Function | Function[];
    returnArrayOf?: Function | Function[];
    returnDictOf?: Function | Function[];
    returnMetaType?: Function | Function[];
    desc?: string;
    markdown?: string;
    deprecated?: boolean;
    tags?: string[];
    throws?: Function | Function[];
    ext?: { [k: string]: any; };
    openapi?: { [k: string]: any; };
    proto?: {
        http?: {
            action?: string | string[];
            path?: string;
        };
        [k: string]: any;
    };

    envelope?: typeof RPCEnvelope | null;

    [k: string]: any;
}
export interface InternalRPCOptions extends RPCOptions {
    paramTypes?: Array<any>;
    paramNames?: Array<string>;
    host?: any;
    hostProto?: any;
    nameOnProto?: any;
    method?: Function;

    _detectEtc?: boolean;
    _host?: any;
    _func?: Function;
}

export const PICK_RPC_PARAM_DECORATION_META_KEY = 'PickPram';

export interface RPCReflection<I = Record<string, any>, O = any, ENV = Record<string, any>> {
    registry: AbstractRPCRegistry;
    name: string;
    conf: InternalRPCOptions & {
        paramOptions: PropOptions<unknown>[];
    };

    env: ENV;
    input: I;

    signal: AbortSignal;

    // Note that hook functions here are intentionally designed to return void instead of Promise of future events.
    // This is to avoid creating a dead lock of promises.
    return: (anything: any) => void;
    then: (resolve: (value: O) => any, reject?: (reason?: any, returnedValueDespiteFailure?: any) => any) => void;
    catch: (reject: (reason?: any, returnedValueDespiteFailure?: any) => any) => void;
    finally: (onfinally?: ((returnedValueRegardlessOfFailure?: any) => any) | undefined) => void;
}

export abstract class AbstractRPCRegistry extends AsyncService {
    static envelope: typeof RPCEnvelope = RPCEnvelope;

    private __tick: number = 1;
    protected __preparedFlag = new WeakSet<InternalRPCOptions>();

    abstract container: typeof DIContainer;

    conf: Map<string, InternalRPCOptions & { paramOptions: PropOptions<unknown>[]; }> = new Map();

    override async init() {
        setImmediate(() => {
            this.__tick++;
            try {
                this.dump();
                this.emit('ready');
            } catch (err) {
                this.emit('error', err);
            }
        });
    }

    register(options: RPCOptions) {
        const names = Array.isArray(options.name) ? options.name : [options.name];

        if (!options.method && !(options.hostProto && options.nameOnProto)) {
            throw new Error(`Unable to resolve RPC ${options.name}: could not find api function.`);
        }
        const resolvedFunc = options.method || options.hostProto[options.nameOnProto];
        if (typeof resolvedFunc !== 'function') {
            throw new Error(`Unable to resolve RPC ${options.name}: found non-function entity, function required.`);
        }

        (options as any).paramOptions = [];

        for (const name of names) {
            if (!name) {
                throw new ParamValidationError('RPC name is required');
            }

            if (this.conf.has(name)) {
                throw new Error(`Duplicated RPC: ${name}`);
            }
            this.conf.set(name, options as InternalRPCOptions & { paramOptions: PropOptions<unknown>[]; });
        }

        if (this.__tick === 1) {
            // Dont do the wrapping in tick 1.
            // Postpone it to tick 2.
            // Stuff could be not ready yet.
            setImmediate(() => {
                this.prepare(options);
            });
            return;
        }

        return this.prepare(options);
    }

    prepare(conf: InternalRPCOptions) {
        if (!conf) {
            throw new Error(`RPCOptions required for prepare`);
        }

        if (this.__preparedFlag.has(conf)) {
            return conf._func;
        }

        const host = this.container.resolve(conf!.hostProto.constructor);

        const func: Function = conf.method || conf.hostProto[conf.nameOnProto]!;
        const paramTypes = conf.paramTypes || [];
        const paramNames = conf.paramNames || [];

        const paramPickerMeta = Reflect.getMetadata(PICK_RPC_PARAM_DECORATION_META_KEY, conf.hostProto);
        const paramPickerConf = paramPickerMeta ? paramPickerMeta[conf.nameOnProto] : undefined;

        // At prepare time we preload the param options so at runtime it's faster.
        for (const [i, t] of paramTypes.entries()) {
            const propOps = paramPickerConf?.[i];
            const propName = paramNames[i];

            if (propOps) {
                if (!propOps.path && propName &&
                    (t !== Object && t !== Promise && NATIVE_CLASS_PROTOTYPES.has(t?.prototype))
                ) {
                    propOps.path = propName;
                }

                conf.paramOptions[i] = { type: t, ...propOps };
            } else if (isAutoCastableClass(t)) {
                const paramOptions: PropOptions<unknown> = { type: t };

                conf.paramOptions[i] = paramOptions;
            }

            // Otherwise we just leave it undefined.
            // It's important to drop the default types from paramTypes, which is injected by TypeScript compiler.
            // Or the default input context would be injected into the RPC call.
            // This would be a surprise and a problematic behavior.

        }

        const detectEtc = paramTypes.find((x) => (x?.prototype instanceof RestParameters || x === RestParameters));


        conf.host ??= host;
        conf._detectEtc = detectEtc;
        conf._host = conf.host;
        conf._func = func;

        this.__preparedFlag.add(conf);

        return func;
    }

    dump() {
        return Array.from(this.conf.entries()).map(([k, conf]) => {
            const prepared = this.prepare(conf);

            return [k, prepared, conf];
        }) as [string, Function, InternalRPCOptions][];
    }

    async exec(name: string, input: object, env?: object, signal?: AbortSignal) {
        const conf = this.conf.get(name);
        const func = conf?._func;

        const afterExecHooks: Function[] = [];
        const catchExecHooks: Function[] = [];

        const addToThenHooks = (
            resolve?: (value: any) => void,
            reject?: (reason?: any, returnedValueDespiteFailure?: any) => void
        ) => {
            if (resolve) {
                afterExecHooks.unshift(resolve);
            }
            if (reject) {
                catchExecHooks.unshift(reject);
            }
        };

        const addToCatchHook = (reject: (reason?: any) => void) => {
            if (reject) {
                catchExecHooks.unshift(reject);
            }
        };

        // Note finally hook is merged with then/catch hook for the sake of deferred run sequence.
        const addToFinallyHook = (handler: (returnedValueRegardlessOfFailure?: any) => void) => {
            if (handler) {
                afterExecHooks.unshift(handler);
                catchExecHooks.unshift((_err: any, despiteErrorSomethingReturned: any) => handler(despiteErrorSomethingReturned));
            }
        };

        const returnDeferred = Defer<any>();
        const reflectReturnHook = (thingToReturn: any) => {
            returnDeferred.resolve(thingToReturn);
        };
        const pr = returnDeferred.promise;
        let abortSignal = signal;
        if (!abortSignal) {
            const abortController = new AbortController();
            abortSignal = abortController.signal;
        }
        abortSignal.throwIfAborted();

        const params = this.fitInputToArgs(name, {
            [RPC_CALL_ENVIRONMENT]: env,
            ...input,
            [RPC_REFLECT]: {
                registry: this,
                name,
                conf,
                input,
                env,
                signal: abortSignal,
                return: reflectReturnHook,
                then: addToThenHooks,
                catch: addToCatchHook,
                finally: addToFinallyHook,
            } as RPCReflection,
        });


        if (!(conf && func)) {
            throw new RPCMethodNotFoundError({ message: `Could not find method of name: ${name}.`, method: name });
        }

        try {
            const px = func.call(conf._host, ...params);

            if (px instanceof Promise || (typeof px?.then === 'function')) {
                (px as Promise<unknown>).then(
                    async (rx) => {
                        returnDeferred.resolve(rx);
                        if (afterExecHooks.length) {
                            const r = await pr;
                            for (const x of afterExecHooks) {
                                await x(r);
                            }
                        }
                    },
                    async (err: any) => {
                        try {
                            if (catchExecHooks.length) {
                                for (const x of catchExecHooks) {
                                    const thing = await Promise.race([pr, NOTHING]).catch(() => NOTHING);
                                    // By design hooks here may end up in unhandled rejection/exception;
                                    await x(err, thing === NOTHING ? undefined : thing);
                                }
                            }
                        } finally {
                            // Return deferred is on purposely delayed to reject here.
                            // Previous catch hooks could decide to return something else.
                            returnDeferred.reject(err);
                        }
                    }
                );

                return pr;
            }

            // From here px is not a promise
            returnDeferred.resolve(px);

            pr.then(async (r) => {
                if (afterExecHooks.length) {
                    for (const x of afterExecHooks) {
                        // By design hooks here may end up in unhandled rejection/exception;
                        await x(r);
                    }
                }
            });

            return pr;
        } catch (err) {
            // Note this branch only executes if rpc method did not return a promise and thrown directly.
            if (catchExecHooks.length) {
                const rEHooks = [];
                for (const x of catchExecHooks) {
                    const thing = await Promise.race([pr, NOTHING]).catch(() => NOTHING);
                    rEHooks.push(x(err, thing === NOTHING ? undefined : thing));
                }
                await Promise.allSettled(rEHooks);
            }
            returnDeferred.reject(err);

            return pr;
        }

    }

    fitInputToArgs(name: string, input: object) {
        const conf = this.conf.get(name);

        if (!conf) {
            throw new Error(`Unknown method: ${name}`);
        }

        let params;
        const etcDetectKit = conf._detectEtc ? shallowDetectRestParametersKeys(input) : undefined;
        const patchedInput = etcDetectKit?.proxy || input;
        try {

            params = conf!.paramOptions.map((paramOption) => {
                if (paramOption?.required === false) {
                    try {
                        return inputSingle('Input', patchedInput, paramOption.path, paramOption);
                    } catch (_err) {
                        return undefined;
                    }
                }
                return inputSingle('Input', patchedInput, paramOption.path, paramOption);
            });

        } catch (err) {
            if (err instanceof ApplicationError) {
                throw err;
            }
            if (err instanceof AutoCastingError) {
                throw new ParamValidationError({
                    ...err,
                    readableMessage: get(err.cause, 'message') || err.reason,
                });
            }

            throw err;
        }

        if (etcDetectKit) {
            const etcKeys = Array.from(etcDetectKit.etcKeys.keys());
            for (const x of params) {
                if (x instanceof RestParameters) {
                    for (const k of etcKeys) {
                        Reflect.set(x, k, Reflect.get(input, k));
                    }
                }
            }
        }

        return params;
    }

    protected resolveEnvelopeClass<T extends typeof RPCEnvelope>(envelopeClass: T) {
        if (this.container.isRegistered(envelopeClass)) {

            return this.container.resolve(envelopeClass);
        }

        const instance = new envelopeClass();
        this.container.register(envelopeClass, { useValue: instance });

        return instance;
    }

    async call(name: string, input: object, options?: {
        overrideEnvelopeClass?: typeof RPCEnvelope;
        env?: object;
        signal?: AbortSignal;
    }): Promise<{
        tpm?: TransferProtocolMetadata;
        output: any,
        succ: boolean,
        err?: any;
    }> {
        const conf = this.conf.get(name);
        const rpcDefinedEnvelope = conf?.envelope;

        let envelopeClass = options?.overrideEnvelopeClass ||
            (rpcDefinedEnvelope === null ? RPCEnvelope : rpcDefinedEnvelope) ||
            (this.constructor as typeof AbstractRPCRegistry).envelope;
        let envelopeInstance: RPCEnvelope = this.resolveEnvelopeClass(envelopeClass);
        let result: any;
        try {
            result = await this.exec(name, input, options?.env, options?.signal);

            const tpm = extractTransferProtocolMeta(result);
            if (!options?.overrideEnvelopeClass && (tpm?.envelope || tpm?.envelope === null)) {
                envelopeClass = tpm.envelope || RPCEnvelope;
                envelopeInstance = this.resolveEnvelopeClass(envelopeClass);
            }

            return {
                ...await envelopeInstance.wrap(result, extractMeta(result)),
                succ: true
            };
        } catch (err) {
            return {
                ...await envelopeInstance.wrapError(err),
                succ: false,
                err
            };
        }
    }


    host(name: string) {
        const conf = this.conf.get(name);

        if (!conf) {
            throw new RPCMethodNotFoundError({ message: `Could not found method of name: ${name}.`, method: name });
        }

        return conf.host;
    }

    Method(options: Partial<RPCOptions> | string = {}) {
        const _options = typeof options === 'string' ? { name: options } : options;

        const MethodDecorator = (tgt: typeof RPCHost.prototype, methodName: string, desc: PropertyDescriptor) => {
            if (!desc.value || (typeof desc.value !== 'function')) {
                throw new Error(`Method decorator can only be used on simple method.`);
            }
            const finalOps: InternalRPCOptions = {
                ..._options,
                name: _options.name || methodName,
                paramTypes: _options.paramTypes || Reflect.getMetadata('design:paramtypes', tgt, methodName),
                paramNames: _options.paramNames || getParamNames(desc.value),
                returnType: _options.returnType || Reflect.getMetadata('design:returntype', tgt, methodName),
                hostProto: tgt,
                nameOnProto: methodName,
            };

            const paramNames = [...(finalOps.paramNames || [])];

            if (paramNames[paramNames.length - 1]?.startsWith('...')) {
                // This fixes the extra parameter caused by reset parameters.
                finalOps.paramNames?.pop();
                finalOps.paramTypes?.pop();
            }

            this.register(finalOps);
        };

        return MethodDecorator;
    }

    RPCMethod(options: Partial<RPCOptions> | string = {}) {
        return this.Method(options);
    }

    Param<T>(path?: string | symbol | PropOptions<T>, conf?: PropOptions<T>) {
        if (typeof path === 'string' || typeof path === 'symbol') {
            if (conf) {
                conf.path = path;
            } else {
                conf = { path: path };
            }
        } else if (typeof path === 'object') {
            conf = path;
        } else {
            conf ??= {};
        }
        const PickCtxParamDecorator = (tgt: typeof RPCHost.prototype, methodName: string, paramIdx: number) => {
            // design:type come from TypeScript compile time decorator-metadata.
            const designType = Reflect.getMetadata('design:paramtypes', tgt, methodName)[paramIdx];
            let paramConf = Reflect.getMetadata(PICK_RPC_PARAM_DECORATION_META_KEY, tgt);
            if (!paramConf) {
                paramConf = {};
                Reflect.defineMetadata(PICK_RPC_PARAM_DECORATION_META_KEY, paramConf, tgt);
            }
            let methodConf = paramConf[methodName];

            if (!methodConf) {
                methodConf = [];
                paramConf[methodName] = methodConf;
            }

            if (conf && !conf.type) {
                conf.type = designType;
            }

            methodConf[paramIdx] = conf ? __patchPropOptionsEnumToSet(conf, designType) : conf;
        };

        return PickCtxParamDecorator;
    }

    decorators() {
        const Method = this.Method.bind(this);

        const Param = this.Param.bind(this);

        const Ctx = (...args: any[]) => Param(RPC_CALL_ENVIRONMENT, ...args);
        const RPCReflect = (...args: any[]) => Param(RPC_REFLECT, ...args);

        return { Method, RPCMethod: Method, Param, Ctx, RPCReflect };
    }
}

export interface PRCRegistryType<T extends typeof DIContainer> extends AbstractRPCRegistry {
    container: T;
}

export function makeRPCKit<T extends typeof DIContainer>(container: T): { new(...args: any[]): PRCRegistryType<T>; } {
    class RPCRegistry extends AbstractRPCRegistry {
        container = container;
    }

    return RPCRegistry;
}
