import { RPCHost } from './base';
import { AsyncService } from '../lib/async-service';
import { RPCMethodNotFoundError } from './errors';
import type { container as DIContainer } from 'tsyringe';
import { inputSingle, PropOptions } from '../lib/auto-castable';

export interface RPCOptions {
    name: string | string[];
    paramTypes?: Array<any>;
    http?: {
        action?: string | string[];
        path?: string;
    }
    host?: any;
    hostProto?: any;
    nameOnProto?: any;
    method?: Function;
}

export const PICK_RPC_PARAM_DECORATION_META_KEY = 'PickPram';

const ITSELF = Symbol('itself');

export abstract class AbstractRPCRegistry extends AsyncService {
    private __tick: number = 0;

    abstract container: typeof DIContainer;

    conf: Map<string, RPCOptions> = new Map();

    wrapped: Map<string, Function> = new Map();

    constructor() {
        super();
        this.__tick = 1;

        this.init();
    }

    init() {
        setImmediate(() => {
            this.__tick++;
            this.dump();
            this.emit('ready');
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

        this.conf.set(name, options);

        if (this.__tick === 1) {
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

        const func: Function = conf.method || conf.hostProto[conf.nameOnProto]!;
        const paramTypes = conf?.paramTypes || [];

        const paramPickerMeta = Reflect.getMetadata(PICK_RPC_PARAM_DECORATION_META_KEY, conf.hostProto);
        const paramPickerConf = paramPickerMeta ? paramPickerMeta[conf.nameOnProto] : undefined;

        const host = this.container.resolve(conf!.hostProto.constructor);

        function patchedRPCMethod<T extends object = any>(this: RPCHost, input: T) {
            const params = paramTypes.map((t, i) => {
                const propOps = paramPickerConf?.[i];

                if (!propOps) {
                    return inputSingle(undefined, { [ITSELF]: input }, ITSELF, { path: ITSELF, type: t });
                }

                return inputSingle(undefined, input, propOps.path, { type: t, ...propOps });
            });

            return func.apply(host, params);
        }

        this.wrapped.set(name, patchedRPCMethod);

        return patchedRPCMethod;
    }

    dump() {
        return Array.from(this.conf.keys()).map((x) => {
            return [x.split('.'), this.wrapRPCMethod(x), this.conf.get(x)];
        }) as [string[], Function, RPCOptions][];
    }

    exec(name: string, input: object) {
        const conf = this.conf.get(name);
        const func = this.wrapped.get(name);

        if (!(conf && func)) {
            throw new RPCMethodNotFoundError({ message: `Could not found method of name: ${name}.`, method: name });
        }

        return func.call(conf.host, input);
    }


    decorators() {
        const RPCMethod = (options: Partial<RPCOptions> | string = {}) => {

            const _options = typeof options === 'string' ? { name: options } : options;

            const RPCDecorator = (tgt: typeof RPCHost.prototype, methodName: string) => {

                const finalOps: RPCOptions = {
                    ..._options,
                    name: _options.name || methodName,
                    paramTypes: _options.paramTypes || Reflect.getMetadata('design:paramtypes', tgt, methodName),
                    hostProto: tgt,
                    nameOnProto: methodName
                };

                this.register(finalOps);
            };

            return RPCDecorator;
        };

        const Pick = <T>(path?: string | symbol | PropOptions<T>, conf?: PropOptions<T>) => {
            if ((typeof path === 'string' || typeof path === 'symbol')) {
                if (conf) {
                    conf.path = path;
                } else {
                    conf = { path: path };
                }
            } else if (typeof path === 'object') {
                conf = path;
            }
            const PickCtxParamDecorator = (tgt: typeof RPCHost.prototype, methodName: string, paramIdx: number) => {
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

                methodConf[paramIdx] = conf;
            };

            return PickCtxParamDecorator;
        };

        return { RPCMethod, Pick };
    }

}

export interface PRCRegistryType<T extends typeof DIContainer> extends AbstractRPCRegistry {
    container: T;
}

export function makeRPCKit<T extends typeof DIContainer>(container: T): { new(): PRCRegistryType<T> } {

    class RPCRegistry extends AbstractRPCRegistry {
        container = container;
    }

    return RPCRegistry;
}


