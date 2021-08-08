import _ from 'lodash';
import { RPCHost, RPCParam, castToType, NOT_RESOLVED } from './base';
import AsyncService from '../lib/async-service';
import { ParamValidationError } from './errors';
import type { container as DIContainer } from 'tsyringe';

export interface RPCOptions {
    name: string | string[];
    paramTypes?: Array<typeof RPCParam>;
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

export const RPC_CALL_ENVIROMENT = Symbol('RPCEnv');

export abstract class AbstractRPCRegistry extends AsyncService {
    private __tick: number = 0;

    abstract container: typeof DIContainer;

    conf: Map<string, RPCOptions> = new Map();

    wrapped: Map<string, Function> = new Map();

    httpSignature: Map<string, string> = new Map();

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

        if (options.http?.action) {
            if (Array.isArray(options.http.action)) {
                for (const x of options.http.action) {
                    this.httpSignature.set(`${x.toUpperCase()} ${options.http.path || '/' + name.split('.').join('/')}`, name);
                }
            } else {
                this.httpSignature.set(`${options.http.action.toUpperCase()} ${options.http.path || '/' + name.split('.').join('/')}`, name);
            }
        } else {
            this.httpSignature.set(`GET ${options.http?.path || '/' + name.split('.').join('/')}`, name);
            this.httpSignature.set(`POST ${options.http?.path || '/' + name.split('.').join('/')}`, name);
        }

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

        function patchedRPCMethod<T extends object = any>(this: RPCHost, ctx: T) {
            const params = paramTypes.map((t, i) => {
                const access = paramPickerConf?.[i];

                if (!access && (t.prototype instanceof RPCParam)) {
                    return (t as typeof RPCParam).fromObject(ctx);
                }
                let input;

                if (typeof access === 'string' || typeof access === 'symbol') {
                    input = _.get(ctx, access);
                } else if (typeof access === 'function') {
                    input = (access as Function).call(this, ctx);
                } else {
                    input = ctx;
                }


                if (access === undefined) {
                    return input;
                }
                if (input === undefined) {
                    return input;
                }

                let output: any;

                try {
                    output = castToType([t], input);
                } catch (err) {
                    throw new ParamValidationError({
                        message: `Validation failed for param[${i}] of method ${name}: input[${access}] not of type [${t.name}].`,
                        path: access, value: input, type: t.name, err
                    });
                }

                if (output === NOT_RESOLVED) {
                    throw new ParamValidationError({
                        message: `Validation failed for param[${i}] of method ${name}: input[${access}] not of type [${t.name}].`,
                        path: access, value: input, type: t.name
                    });
                }

                return output;
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

        const Pick = (path?: string | symbol | ((ctx: object) => any)) => {
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

                methodConf[paramIdx] = path || true;
            };

            return PickCtxParamDecorator;
        };

        return { RPCMethod, Pick };
    }

}




export function makeRPCKit(container: typeof DIContainer): typeof AbstractRPCRegistry {

    class RPCRegistry extends AbstractRPCRegistry {
        container = container;
    }

    return RPCRegistry;
}


