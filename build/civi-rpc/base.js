"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inputSingle = exports.castToType = exports.RPCParam = exports.RPCHost = exports.NOT_RESOLVED = exports.RPC_CALL_ENVIROMENT = exports.RPCPARAM_OPTIONS_SYMBOL = void 0;
const tslib_1 = require("tslib");
require("reflect-metadata");
const lang_1 = require("../utils/lang");
const errors_1 = require("./errors");
const async_service_1 = require("../lib/async-service");
const lodash_1 = tslib_1.__importDefault(require("lodash"));
const meta_1 = require("./meta");
exports.RPCPARAM_OPTIONS_SYMBOL = Symbol('RPCParam options');
exports.RPC_CALL_ENVIROMENT = Symbol('RPCEnv');
exports.NOT_RESOLVED = Symbol('Not-Resolved');
class RPCHost extends async_service_1.AsyncService {
    setResultMeta(target, metaToSet) {
        meta_1.assignMeta(target, metaToSet);
        return target;
    }
    getResultMeta(target) {
        return meta_1.extractMeta(target);
    }
}
exports.RPCHost = RPCHost;
class RPCParam {
    static fromObject(input) {
        const instance = new this();
        if (input.hasOwnProperty(exports.RPC_CALL_ENVIROMENT)) {
            instance[exports.RPC_CALL_ENVIROMENT] = input[exports.RPC_CALL_ENVIROMENT];
        }
        for (const [prop, config] of lang_1.chainEntries(this.prototype[exports.RPCPARAM_OPTIONS_SYMBOL] || {})) {
            instance[prop] = inputSingle(this, input, prop, config);
        }
        return instance;
    }
    static fromContext(ctx) {
        return this.fromObject(ctx);
    }
}
exports.RPCParam = RPCParam;
const nativeTypes = new Set([
    RegExp,
    Buffer
]);
function castToType(ensureTypes, inputProp) {
    let val = exports.NOT_RESOLVED;
    let lastErr;
    if (inputProp === undefined) {
        if (ensureTypes.includes(undefined)) {
            return undefined;
        }
        return exports.NOT_RESOLVED;
    }
    for (const typeShouldbe of ensureTypes) {
        if (typeShouldbe.prototype instanceof RPCParam) {
            try {
                val = typeShouldbe.fromObject(inputProp);
            }
            catch (err) {
                lastErr = err;
                continue;
            }
            if (val instanceof typeShouldbe) {
                break;
            }
            continue;
        }
        if (nativeTypes.has(typeShouldbe)) {
            try {
                val = new typeShouldbe(inputProp);
            }
            catch (err) {
                lastErr = err;
                continue;
            }
            if (val instanceof typeShouldbe) {
                break;
            }
            continue;
        }
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
                    }
                    else if (intVal < Math.pow(10, 10)) {
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
            case Array:
            case Object: {
                val = inputProp;
                break;
            }
            default: {
                if ((typeof typeShouldbe === 'function') && (inputProp instanceof typeShouldbe)) {
                    val = inputProp;
                }
                else if (lang_1.isConstructor(typeShouldbe)) {
                    try {
                        val = new typeShouldbe(inputProp);
                    }
                    catch (err) {
                        lastErr = err;
                        continue;
                    }
                }
                else if (typeof typeShouldbe === 'function') {
                    try {
                        val = typeShouldbe(inputProp);
                    }
                    catch (err) {
                        lastErr = err;
                        continue;
                    }
                }
                else if (typeShouldbe instanceof Set) {
                    if (!typeShouldbe.has(inputProp)) {
                        continue;
                    }
                    val = inputProp;
                }
            }
        }
        if (val !== exports.NOT_RESOLVED) {
            break;
        }
    }
    if (val === exports.NOT_RESOLVED && lastErr) {
        throw lastErr;
    }
    return val;
}
exports.castToType = castToType;
function inputSingle(host, input, prop, config) {
    let types;
    let isArray = false;
    const access = config.path || prop;
    const mappedPath = (host?.name && prop) ? `${host.name}.${prop.toString()}` : `input[${access.toString()}]`;
    if (config.arrayOf) {
        isArray = true;
        types = Array.isArray(config.arrayOf) ? config.arrayOf : [config.arrayOf];
    }
    else if (config.type) {
        types = Array.isArray(config.type) ? config.type : [config.type];
    }
    else {
        throw new Error(`Type info not provided: ${access.toString()}`);
    }
    const inputProp = lodash_1.default.get(input, access);
    if (inputProp === undefined && config.default !== undefined) {
        return config.default;
    }
    if (inputProp === undefined && config.required) {
        throw new errors_1.ParamValidationError({
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
        const values = [];
        for (const [i, x] of arrayInput.entries()) {
            let elem = exports.NOT_RESOLVED;
            try {
                elem = castToType(types, x);
            }
            catch (err) {
                const typeNames = types.map((t) => (t.name ? t.name : t).toString());
                throw new errors_1.ParamValidationError({
                    message: `Validation failed for ${mappedPath}: ${access.toString()}[${i}] not within type [${typeNames.join('|')}].`,
                    path: `${access.toString()}[${i}]`, value: x, types: typeNames, error: err.toString()
                });
            }
            if (elem === exports.NOT_RESOLVED) {
                const typeNames = types.map((t) => (t.name ? t.name : t).toString());
                throw new errors_1.ParamValidationError({
                    message: `Validation failed for ${mappedPath}: ${access.toString()}[${i}] not within type [${typeNames.join('|')}].`,
                    path: `${access.toString()}[${i}]`, value: x, types: typeNames
                });
            }
            if (config.validate) {
                const result = config.validate(elem, input);
                if (!result) {
                    throw new errors_1.ParamValidationError({
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
    let item = exports.NOT_RESOLVED;
    try {
        item = castToType(types, inputProp);
    }
    catch (err) {
        if (inputProp !== undefined) {
            const typeNames = types.map((t) => (t.name ? t.name : t).toString());
            throw new errors_1.ParamValidationError({
                message: `Validation failed for ${mappedPath}: ${access.toString()} not within type [${typeNames.join('|')}].`,
                path: `${access.toString()}`, value: inputProp, types: typeNames, error: err.toString()
            });
        }
    }
    if (item === exports.NOT_RESOLVED || item === undefined) {
        if (config.default) {
            return config.default;
        }
        if (config.required || inputProp !== undefined) {
            const typeNames = types.map((t) => (t.name ? t.name : t).toString());
            throw new errors_1.ParamValidationError({
                message: `Validation failed for ${mappedPath}: ${access.toString()} not within type [${typeNames.join('|')}].`,
                path: `${access.toString()}`, value: inputProp, types: typeNames
            });
        }
        return undefined;
    }
    if (config.validate) {
        const result = config.validate(item, input);
        if (!result) {
            throw new errors_1.ParamValidationError({
                message: `Validation failed for ${mappedPath}: ${access.toString()} rejected by validator ${config.validate.name}.`,
                path: `${access.toString()}`, value: inputProp, validator: config.validate.name
            });
        }
    }
    return item;
}
exports.inputSingle = inputSingle;
//# sourceMappingURL=base.js.map