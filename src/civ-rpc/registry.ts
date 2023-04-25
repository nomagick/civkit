import { RPCEnvelope, RPCHost, RPC_CALL_ENVIRONMENT, RPC_REFLECT } from './base';
import { AsyncService } from '../lib/async-service';
import {
    RPCMethodNotFoundError,
    ParamValidationError,
    ApplicationError,
} from './errors';
import type { container as DIContainer } from 'tsyringe';
import {
    AutoCastableMetaClass, AutoCastingError,
    inputSingle, isAutoCastableClass, PropOptions, __patchPropOptionsEnumToSet
} from '../lib/auto-castable';
import { RestParameters, shallowDetectRestParametersKeys } from './magic';
import { extractMeta, extractTransferProtocolMeta, TransferProtocolMetadata } from './meta';
import { get } from 'lodash';

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
    returnMetaType?: (typeof AutoCastableMetaClass) | (typeof AutoCastableMetaClass)[];
    desc?: string;
    markdown?: string;
    ext?: { [k: string]: any; };
    deprecated?: boolean;
    tags?: string[];
    throws?: Function | Function[];

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

export interface RPCReflection {
    registry: AbstractRPCRegistry;
    name: string;
    conf: InternalRPCOptions & {
        paramOptions: PropOptions<unknown>[];
    };
}

export abstract class AbstractRPCRegistry extends AsyncService {
    static envelope: typeof RPCEnvelope = RPCEnvelope;

    private __tick: number = 1;

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
        const name = Array.isArray(options.name) ? options.name.join('.') : options.name;

        if (!name) {
            throw new ParamValidationError('RPC name is required');
        }

        if (this.conf.has(name)) {
            throw new Error(`Duplicated RPC: ${name}`);
        }

        if (!options.method && !(options.hostProto && options.nameOnProto)) {
            throw new Error(`Unable to resolve RPC ${options.name}: could not find api function.`);
        }
        const resolvedFunc = options.method || options.hostProto[options.nameOnProto];
        if (typeof resolvedFunc !== 'function') {
            throw new Error(`Unable to resolve RPC ${options.name}: found non-function entity, function required.`);
        }

        (options as any).paramOptions = [];

        this.conf.set(name, options as InternalRPCOptions & { paramOptions: PropOptions<unknown>[]; });

        if (this.__tick === 1) {
            // Dont do the wrapping in tick 1.
            // Postpone it to tick 2.
            // Stuff could be not ready yet.
            setImmediate(() => {
                this.prepare(name);
            });
            return;
        }

        return this.prepare(name);
    }

    prepare(name: string) {
        const conf = this.conf.get(name);

        if (!conf) {
            throw new Error(`Unknown method: ${name}`);
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

            if (!propOps) {
                const paramOptions: PropOptions<unknown> = { type: t };

                conf.paramOptions[i] = paramOptions;

                if (!isAutoCastableClass(t) && propName) {
                    paramOptions.path = propName;
                }

                continue;
            }

            conf.paramOptions[i] = { type: t, ...propOps };
        }

        const detectEtc = paramTypes.find((x) => (x?.prototype instanceof RestParameters || x === RestParameters));


        conf.host ??= host;
        conf._detectEtc = detectEtc;
        conf._host = conf.host;
        conf._func = func;

        return func;
    }

    dump() {
        return Array.from(this.conf.keys()).map((x) => {
            return [x, this.prepare(x), this.conf.get(x)];
        }) as [string, Function, InternalRPCOptions][];
    }

    exec(name: string, input: object, env?: object) {
        const conf = this.conf.get(name);
        const func = conf?._func;

        const params = this.fitInputToArgs(name, {
            [RPC_CALL_ENVIRONMENT]: env,
            ...input,
            [RPC_REFLECT]: {
                registry: this,
                name,
                conf
            },
        });

        if (!(conf && func)) {
            throw new RPCMethodNotFoundError({ message: `Could not find method of name: ${name}.`, method: name });
        }

        return func.call(conf._host, ...params);
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
            result = await this.exec(name, input, options?.env);

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

    RPCMethod(options: Partial<RPCOptions> | string = {}) {
        const _options = typeof options === 'string' ? { name: options } : options;

        const RPCDecorator = (tgt: typeof RPCHost.prototype, methodName: string, desc: PropertyDescriptor) => {
            if (!desc.value || (typeof desc.value !== 'function')) {
                throw new Error(`RPCMethod decorator can only be used on simple method.`);
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

        return RPCDecorator;
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
        const RPCMethod = this.RPCMethod.bind(this);

        const Param = this.Param.bind(this);

        const Ctx = (...args: any[]) => Param(RPC_CALL_ENVIRONMENT, ...args);
        const RPCReflect = (...args: any[]) => Param(RPC_REFLECT, ...args);

        return { RPCMethod, Param, Ctx, RPCReflect };
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
