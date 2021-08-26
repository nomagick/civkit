import 'reflect-metadata';
import { isConstructor, chainEntries } from '../utils/lang';
import { ParamValidationError } from './errors';
import { AsyncService } from '../lib/async-service';
import _ from 'lodash';
import { assignMeta, extractMeta } from './meta';

export const RPCPARAM_OPTIONS_SYMBOL = Symbol('RPCParam options');

export const RPC_CALL_ENVIROMENT = Symbol('RPCEnv');

export const NOT_RESOLVED = Symbol('Not-Resolved');

export class RPCHost extends AsyncService {
    setResultMeta(target: object, metaToSet: object) {
        assignMeta(target, metaToSet);

        return target;
    }

    getResultMeta(target: object) {

        return extractMeta(target);
    }
}

export class RPCParam<T = any> {
    [RPCPARAM_OPTIONS_SYMBOL]: { [k: string]: PropOptions<any> };
    [RPC_CALL_ENVIROMENT]?: T;

    static fromObject(input: object) {
        const instance = new this();

        if (input.hasOwnProperty(RPC_CALL_ENVIROMENT)) {
            instance[RPC_CALL_ENVIROMENT] = (input as any)[RPC_CALL_ENVIROMENT];
        }

        for (const [prop, config] of chainEntries(this.prototype[RPCPARAM_OPTIONS_SYMBOL] || {})) {

            (instance as any)[prop] = inputSingle(this, input, prop, config);

        }

        return instance;
    }

    static fromContext<T extends object>(ctx: T) {
        return this.fromObject(ctx);
    }

}

export const nativeTypes = new Set<new (p: any) => any>([
    RegExp
]);


export function castToType(ensureTypes: any[], inputProp: any) {
    let val: any = NOT_RESOLVED;
    let lastErr: Error | undefined | unknown;
    if (inputProp === undefined) {
        if (ensureTypes.includes(undefined)) {
            return undefined;
        }

        return NOT_RESOLVED;
    }

    for (const typeShouldbe of ensureTypes) {
        // RPCParam types
        if (typeShouldbe.prototype instanceof RPCParam) {

            try {
                val = typeShouldbe.fromObject(inputProp);
            } catch (err) {
                lastErr = err;
                continue;
            }

            if (val instanceof typeShouldbe) {
                break;
            }
            continue;
        }

        // Native types like Date, RegExp, etc..
        if (nativeTypes.has(typeShouldbe)) {
            try {
                val = new typeShouldbe(inputProp);
            } catch (err) {
                lastErr = err;
                continue;
            }

            if (val instanceof typeShouldbe) {
                break;
            }
            continue;
        }

        // Primitive types like Number, String, etc...
        switch (typeShouldbe) {

            case Buffer: {
                val = Buffer.from(inputProp);
                break;
            }

            case Number: {
                val = Number(inputProp);
                if (isNaN(val)) {
                    continue;
                }
                break;
            }

            case String: {
                val = String(inputProp);
                break;
            }

            case Boolean: {
                val = Boolean(inputProp);
                break;
            }

            case Date: {
                const tmpDate = new Date(inputProp);
                if (isNaN(tmpDate.valueOf())) {

                    const intVal = parseInt(inputProp, 10);

                    if (intVal >= Math.pow(10, 10)) {
                        val = new Date(intVal);

                        break;
                    } else if (intVal < Math.pow(10, 10)) {
                        val = new Date(intVal * 1000);

                        break;
                    }

                    continue;
                }
                val = tmpDate;

                break;
            }

            case null: {
                val = null;

                break;
            }

            case undefined: {
                val = undefined;

                break;
            }

            // Object/Array is the type of all mixed/any/T[] types.
            case Array:
            case Object: {
                val = inputProp;

                break;
            }
            default: {
                if ((typeof typeShouldbe === 'function') && (inputProp instanceof typeShouldbe)) {
                    val = inputProp;
                } else if (isConstructor(typeShouldbe)) {
                    try {
                        val = new typeShouldbe(inputProp);
                    } catch (err) {
                        lastErr = err;
                        continue;
                    }
                } else if (typeof typeShouldbe === 'function') {
                    try {
                        val = typeShouldbe(inputProp);
                    } catch (err) {
                        lastErr = err;
                        continue;
                    }
                } else if (typeShouldbe instanceof Set) {
                    // Enums would end up here
                    if (!typeShouldbe.has(inputProp)) {
                        continue;
                    }

                    val = inputProp;
                }
            }
        }

        if (val !== NOT_RESOLVED) {
            break;
        }
    }

    if (val === NOT_RESOLVED && lastErr) {
        throw lastErr;
    }

    return val;
}

export function inputSingle<T>(host: Function | undefined, input: any, prop: string | symbol, config: PropOptions<T>) {
    let types: any;
    let isArray = false;
    const access = config.path || prop;
    const mappedPath = (host?.name && prop) ? `${host.name}.${prop.toString()}` : `input[${access.toString()}]`;

    if (config.arrayOf) {
        isArray = true;
        types = Array.isArray(config.arrayOf) ? config.arrayOf : [config.arrayOf];
    } else if (config.type) {
        types = Array.isArray(config.type) ? config.type : [config.type];
    } else {
        throw new Error(`Type info not provided: ${access.toString()}`);
    }

    const inputProp = _.get(input, access);

    if (inputProp === undefined && config.default !== undefined) {
        return config.default;
    }

    if (inputProp === undefined && config.required) {
        throw new ParamValidationError({
            message: `Validation failed for ${mappedPath}: ${access.toString()} is required but not provided.`,
            path: config.path, value: inputProp
        });
    }

    if (isArray) {
        if (inputProp === null) {
            return [];
        }
        if (inputProp === undefined) {
            return undefined;
        }

        const arrayInput = Array.isArray(inputProp) ? inputProp : [inputProp];

        const values: any[] = [];

        for (const [i, x] of arrayInput.entries()) {
            let elem: any = NOT_RESOLVED;
            try {
                elem = castToType(types, x);

            } catch (err: any) {
                const typeNames = types.map((t: any) => (t.name ? t.name : t).toString());
                throw new ParamValidationError({
                    message: `Validation failed for ${mappedPath}: ${access.toString()}[${i}] not within type [${typeNames.join('|')}].`,
                    path: `${access.toString()}[${i}]`, value: x, types: typeNames, error: err.toString()
                });
            }

            if (elem === NOT_RESOLVED) {
                const typeNames = types.map((t: any) => (t.name ? t.name : t).toString());
                throw new ParamValidationError({
                    message: `Validation failed for ${mappedPath}: ${access.toString()}[${i}] not within type [${typeNames.join('|')}].`,
                    path: `${access.toString()}[${i}]`, value: x, types: typeNames
                });
            }

            if (config.validate) {
                const result = config.validate(elem, input);

                if (!result) {
                    throw new ParamValidationError({
                        message: `Validation failed for ${mappedPath}: ${access.toString()}[${i}] rejected by validator ${config.validate.name}.`,
                        path: `${access.toString()}[${i}]`, value: x, validator: config.validate.name
                    });
                }
            }

            if (elem === undefined) {
                continue;
            }

            values.push(elem);
        }

        return values;
    }

    if (inputProp === null) {
        return null;
    }

    let item: any = NOT_RESOLVED;

    try {
        item = castToType(types, inputProp);
    } catch (err: any) {
        if (inputProp !== undefined) {
            const typeNames = types.map((t: any) => (t.name ? t.name : t).toString());
            throw new ParamValidationError({
                message: `Validation failed for ${mappedPath}: ${access.toString()} not within type [${typeNames.join('|')}].`,
                path: `${access.toString()}`, value: inputProp, types: typeNames, error: err.toString()
            });
        }

    }

    if (item === NOT_RESOLVED || item === undefined) {

        if (config.default) {
            return config.default;
        }

        if (config.required || inputProp !== undefined) {
            const typeNames = types.map((t: any) => (t.name ? t.name : t).toString());
            throw new ParamValidationError({
                message: `Validation failed for ${mappedPath}: ${access.toString()} not within type [${typeNames.join('|')}].`,
                path: `${access.toString()}`, value: inputProp, types: typeNames
            });
        }

        return undefined;
    }

    if (config.validate) {
        const result = config.validate(item, input);

        if (!result) {
            throw new ParamValidationError({
                message: `Validation failed for ${mappedPath}: ${access.toString()} rejected by validator ${config.validate.name}.`,
                path: `${access.toString()}`, value: inputProp, validator: config.validate.name
            });
        }
    }

    return item;
}

export type Enum = Set<number | string> | { [k: string]: number | string, [w: number]: number | string };

export interface PropOptions<T> {
    path?: string | symbol;
    type?: any | any[];
    arrayOf?: any | any[];
    validate?: (val: T, obj?: any) => boolean;
    required?: boolean;
    default?: T;
}
