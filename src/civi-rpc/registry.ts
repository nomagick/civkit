import { RPCHost, RPC_CALL_ENVIROMENT } from './base';
import { AsyncService } from '../lib/async-service';
import { Defer } from '../lib/defer';
import { RPCMethodNotFoundError, ParamValidationError, ApplicationError, DataCorruptionError } from './errors';
import type { container as DIContainer } from 'tsyringe';
import { AutoCastingError, inputSingle, PropOptions, __patchPropOptionsEnumToSet } from '../lib/auto-castable';

export interface RPCOptions {
    name: string | string[];
    paramTypes?: Array<any>;
    host?: any;
    hostProto?: any;
    nameOnProto?: any;
    method?: Function;
    returnType?: Function | Function[];
    returnArrayOf?: Function | Function[];
    returnDictOf?: Function | Function[];
    desc?: string;
    ext?: { [k: string]: any; };
}

export const PICK_RPC_PARAM_DECORATION_META_KEY = 'PickPram';

const ROOT_INPUT = Symbol('RootInput');
const ROOT_RETURN = Symbol('RootReturn');

export abstract class AbstractRPCRegistry extends AsyncService {
    private __tick: number = 0;

    abstract container: typeof DIContainer;

    conf: Map<string, RPCOptions & { paramOptions: PropOptions<unknown>[]; }> = new Map();

    wrapped: Map<string, Function> = new Map();

    constructor() {
        super();
        this.__tick = 1;

        this.init();
    }

    override init() {
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
            throw new Error('RPC name is required');
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

        this.conf.set(name, options as RPCOptions & { paramOptions: PropOptions<unknown>[]; });

        if (this.__tick === 1) {
            // Dont do the wrapping in tick 1.
            // Postpone it to tick 2.
            // Stuff could be not ready yet.
            setImmediate(() => {
                this.wrapRPCMethod(name);
            });
            return;
        }

        return this.wrapRPCMethod(name);
    }

    wrapRPCMethod(name: string) {
        const conf = this.conf.get(name);

        if (!conf) {
            throw new Error(`Unknown method: ${name}`);
        }

        if (this.wrapped.has(name)) {
            return this.wrapped.get(name);
        }

        const host = this.container.resolve(conf!.hostProto.constructor);

        const func: Function = conf.method || conf.hostProto[conf.nameOnProto]!;
        const paramTypes = conf.paramTypes || [];

        const paramPickerMeta = Reflect.getMetadata(PICK_RPC_PARAM_DECORATION_META_KEY, conf.hostProto);
        const paramPickerConf = paramPickerMeta ? paramPickerMeta[conf.nameOnProto] : undefined;

        function patchedRPCMethod<T extends object = any>(this: RPCHost, input: T) {
            let params;
            try {
                params = paramTypes.map((t, i) => {
                    const propOps = paramPickerConf?.[i];

                    if (!propOps) {

                        const paramOptions = { path: ROOT_INPUT, type: t };

                        conf!.paramOptions[i] = paramOptions;

                        return inputSingle(func, { [ROOT_INPUT]: input }, ROOT_INPUT, paramOptions);
                    }

                    conf!.paramOptions[i] = { type: t, ...propOps };

                    return inputSingle(undefined, input, propOps.path, { type: t, ...propOps });
                });
            } catch (err) {
                if (err instanceof ApplicationError) {
                    throw err;
                }
                if (err instanceof AutoCastingError) {
                    throw new ParamValidationError({ ...err, err, message: err.message });
                }

                throw err;
            }

            const r = func.apply(host, params);

            if (!(conf!.returnType || conf!.returnArrayOf || conf!.returnDictOf)) {
                return r;
            }

            if (r instanceof Promise || typeof r.then === 'function') {
                const deferred = Defer<T>();

                r.then(
                    (resolved: any) => {
                        try {
                            const transformed = inputSingle(func, { [ROOT_RETURN]: resolved }, ROOT_RETURN, {
                                path: ROOT_RETURN,
                                type: conf!.returnType,
                                arrayOf: conf!.returnArrayOf,
                                dictOf: conf!.returnDictOf,
                                desc: conf!.desc,
                            });

                            deferred.resolve(transformed);
                        } catch (err) {
                            if (err instanceof ApplicationError) {
                                return deferred.reject(err);
                            }
                            if (err instanceof AutoCastingError) {
                                return deferred.reject(new DataCorruptionError({ err }));
                            }

                            return deferred.reject(err);
                        }
                    },
                    (rejected: any) => {
                        deferred.reject(rejected);
                    }
                );

                return deferred.promise;
            }

            return r;
        }

        this.wrapped.set(name, patchedRPCMethod);

        return patchedRPCMethod;
    }

    dump() {
        return Array.from(this.conf.keys()).map((x) => {
            return [x, this.wrapRPCMethod(x), this.conf.get(x)];
        }) as [string, Function, RPCOptions][];
    }

    exec(name: string, input: object) {
        const conf = this.conf.get(name);
        const func = this.wrapped.get(name);

        if (!(conf && func)) {
            throw new RPCMethodNotFoundError({ message: `Could not found method of name: ${name}.`, method: name });
        }

        return func.call(conf.host, input);
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

        const RPCDecorator = (tgt: typeof RPCHost.prototype, methodName: string) => {
            const finalOps: RPCOptions = {
                ..._options,
                name: _options.name || methodName,
                paramTypes: _options.paramTypes || Reflect.getMetadata('design:paramtypes', tgt, methodName),
                hostProto: tgt,
                nameOnProto: methodName,
            };

            this.register(finalOps);
        };

        return RPCDecorator;
    }

    Pick<T>(path?: string | symbol | PropOptions<T>, conf?: PropOptions<T>) {
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

            methodConf[paramIdx] = conf ? __patchPropOptionsEnumToSet(conf, designType) : conf;
        };

        return PickCtxParamDecorator;
    }

    decorators() {
        const RPCMethod = this.RPCMethod.bind(this);

        const Pick = this.Pick.bind(this);

        const Ctx = (...args: any[]) => Pick(RPC_CALL_ENVIROMENT, ...args);

        return { RPCMethod, Pick, Ctx };
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
