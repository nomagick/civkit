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
            let types: any;
            let isArray = false;

            if (config.arrayOf) {
                isArray = true;
                types = Array.isArray(config.arrayOf) ? config.arrayOf : [config.arrayOf];
            } else if (config.type) {
                types = Array.isArray(config.type) ? config.type : [config.type];
            } else {
                throw new Error(`Type info not provided: ${this.name}.${prop}`);
            }

            const inputProp = _.get(input, config.path || prop);

            if (inputProp === undefined && config.default !== undefined) {
                (instance as any)[prop] = config.default;

                continue;
            }

            if (inputProp === undefined && config.required) {
                throw new ParamValidationError({
                    message: `Validation failed for ${this.name}.${prop}: ${config.path} is required but not provided.`,
                    path: config.path, value: inputProp
                });
            }

            if (isArray) {
                if (inputProp === null) {
                    (instance as any)[prop] = [] as any;

                    continue;
                }
                if (inputProp === undefined) {
                    continue;
                }

                const arrayInput = Array.isArray(inputProp) ? inputProp : [inputProp];

                const values: any[] = [];

                for (const [i, x] of arrayInput.entries()) {
                    let elem = NOT_RESOLVED;
                    try {
                        elem = __parseInput(types, x);

                    } catch (err: any) {
                        const typeNames = types.map((t: any) => (t.name ? t.name : t).toString());
                        throw new ParamValidationError({
                            message: `Validation failed for ${this.name}.${prop}: ${config.path}[${i}] not within type [${typeNames.join('|')}].`,
                            path: `${config.path}[${i}]`, value: x, types: typeNames, error: err.toString()
                        });
                    }

                    if (elem === NOT_RESOLVED) {
                        const typeNames = types.map((t: any) => (t.name ? t.name : t).toString());
                        throw new ParamValidationError({
                            message: `Validation failed for ${this.name}.${prop}: ${config.path}[${i}] not within type [${typeNames.join('|')}].`,
                            path: `${config.path}[${i}]`, value: x, types: typeNames
                        });
                    }

                    if (config.validate) {
                        const result = config.validate(elem, input);

                        if (!result) {
                            throw new ParamValidationError({
                                message: `Validation failed for ${this.name}.${prop}: ${config.path}[${i}] rejected by validator ${config.validate.name}.`,
                                path: `${config.path}[${i}]`, value: x, validator: config.validate.name
                            });
                        }
                    }

                    if (elem === undefined) {
                        continue;
                    }

                    values.push(elem);
                }

                (instance as any)[prop] = values;

                continue;
            }

            if (inputProp === null) {
                (instance as any)[prop] = null;

                continue;
            }

            let item = NOT_RESOLVED;

            try {
                item = __parseInput(types, inputProp);
            } catch (err: any) {
                if (inputProp !== undefined) {
                    const typeNames = types.map((t: any) => (t.name ? t.name : t).toString());
                    throw new ParamValidationError({
                        message: `Validation failed for ${this.name}.${prop}: ${config.path} not within type [${typeNames.join('|')}].`,
                        path: `${config.path}`, value: inputProp, types: typeNames, error: err.toString()
                    });
                }

            }

            if (item === NOT_RESOLVED || item === undefined) {

                if (config.default) {
                    (instance as any)[prop] = config.default;

                    continue;
                }

                if (config.required || inputProp !== undefined) {
                    const typeNames = types.map((t: any) => (t.name ? t.name : t).toString());
                    throw new ParamValidationError({
                        message: `Validation failed for ${this.name}.${prop}: ${config.path} not within type [${typeNames.join('|')}].`,
                        path: `${config.path}`, value: inputProp, types: typeNames
                    });
                }

                continue;
            }

            if (config.validate) {
                const result = config.validate(item, input);

                if (!result) {
                    throw new ParamValidationError({
                        message: `Validation failed for ${this.name}.${prop}: ${config.path} rejected by validator ${config.validate.name}.`,
                        path: `${config.path}`, value: inputProp, validator: config.validate.name
                    });
                }
            }

            (instance as any)[prop] = item;

        }

        return instance;
    }

    static fromContext<T extends object>(ctx: T) {
        return this.fromObject(ctx);
    }

}

const nativeTypes = new Set<new (p: any) => any>([
    RegExp,
    Buffer
]);


function __parseInput(ensureTypes: any[], inputProp: any) {
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

        // Native types like Date, RegExp, Buffer, etc..
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

            case Number: {
                val = Number(inputProp);
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

export const castToType = __parseInput;

export type Enum = Set<number | string> | { [k: string]: number | string, [w: number]: number | string };

export interface PropOptions<T> {
    path?: string;
    type?: (new (...whatever: any[]) => T) | Array<(new (...whatever: any[]) => T) | Enum | null> | Enum | null;
    arrayOf?: (new (...whatever: any[]) => T) | Array<(new (...whatever: any[]) => T) | Enum | null> | Enum | null;
    validate?: (val: T, obj?: any) => boolean;
    required?: boolean;
    default?: T;
}
