"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.castToType = exports.RPCParam = exports.RPCHost = exports.NOT_RESOLVED = exports.RPCPARAM_OPTIONS_SYMBOL = void 0;
const tslib_1 = require("tslib");
require("reflect-metadata");
const lang_1 = require("../utils/lang");
const errors_1 = require("./errors");
const async_service_1 = tslib_1.__importDefault(require("../lib/async-service"));
const lodash_1 = tslib_1.__importDefault(require("lodash"));
const meta_1 = require("./meta");
exports.RPCPARAM_OPTIONS_SYMBOL = Symbol('RPCParam options');
exports.NOT_RESOLVED = Symbol('Not-Resolved');
class RPCHost extends async_service_1.default {
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
        for (const [prop, config] of lang_1.chainEntries(this.prototype[exports.RPCPARAM_OPTIONS_SYMBOL] || {})) {
            let types;
            let isArray = false;
            if (config.arrayOf) {
                isArray = true;
                types = Array.isArray(config.arrayOf) ? config.arrayOf : [config.arrayOf];
            }
            else if (config.type) {
                types = Array.isArray(config.type) ? config.type : [config.type];
            }
            else {
                throw new Error(`Type info not provided: ${this.name}.${prop}`);
            }
            const inputProp = lodash_1.default.get(input, config.path || prop);
            if (inputProp === undefined && config.default !== undefined) {
                instance[prop] = config.default;
                continue;
            }
            if (inputProp === undefined && config.required) {
                throw new errors_1.ParamValidationError({
                    message: `Validation failed for ${this.name}.${prop}: ${config.path} is required but not provided.`,
                    path: config.path, value: inputProp
                });
            }
            if (isArray) {
                if (inputProp === null) {
                    instance[prop] = [];
                    continue;
                }
                if (inputProp === undefined) {
                    continue;
                }
                const arrayInput = Array.isArray(inputProp) ? inputProp : [inputProp];
                const values = [];
                for (const [i, x] of arrayInput.entries()) {
                    let elem = exports.NOT_RESOLVED;
                    try {
                        elem = __parseInput(types, x);
                    }
                    catch (err) {
                        const typeNames = types.map((t) => (t.name ? t.name : t).toString());
                        throw new errors_1.ParamValidationError({
                            message: `Validation failed for ${this.name}.${prop}: ${config.path}[${i}] not within type [${typeNames.join('|')}].`,
                            path: `${config.path}[${i}]`, value: x, types: typeNames, error: err.toString()
                        });
                    }
                    if (elem === exports.NOT_RESOLVED) {
                        const typeNames = types.map((t) => (t.name ? t.name : t).toString());
                        throw new errors_1.ParamValidationError({
                            message: `Validation failed for ${this.name}.${prop}: ${config.path}[${i}] not within type [${typeNames.join('|')}].`,
                            path: `${config.path}[${i}]`, value: x, types: typeNames
                        });
                    }
                    if (config.validate) {
                        const result = config.validate(elem, input);
                        if (!result) {
                            throw new errors_1.ParamValidationError({
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
                instance[prop] = values;
                continue;
            }
            if (inputProp === null) {
                instance[prop] = null;
                continue;
            }
            let item = exports.NOT_RESOLVED;
            try {
                item = __parseInput(types, inputProp);
            }
            catch (err) {
                if (inputProp !== undefined) {
                    const typeNames = types.map((t) => (t.name ? t.name : t).toString());
                    throw new errors_1.ParamValidationError({
                        message: `Validation failed for ${this.name}.${prop}: ${config.path} not within type [${typeNames.join('|')}].`,
                        path: `${config.path}`, value: inputProp, types: typeNames, error: err.toString()
                    });
                }
            }
            if (item === exports.NOT_RESOLVED || item === undefined) {
                if (config.default) {
                    instance[prop] = config.default;
                    continue;
                }
                if (config.required || inputProp !== undefined) {
                    const typeNames = types.map((t) => (t.name ? t.name : t).toString());
                    throw new errors_1.ParamValidationError({
                        message: `Validation failed for ${this.name}.${prop}: ${config.path} not within type [${typeNames.join('|')}].`,
                        path: `${config.path}`, value: inputProp, types: typeNames
                    });
                }
                continue;
            }
            if (config.validate) {
                const result = config.validate(item, input);
                if (!result) {
                    throw new errors_1.ParamValidationError({
                        message: `Validation failed for ${this.name}.${prop}: ${config.path} rejected by validator ${config.validate.name}.`,
                        path: `${config.path}`, value: inputProp, validator: config.validate.name
                    });
                }
            }
            instance[prop] = item;
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
function __parseInput(ensureTypes, inputProp) {
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
exports.castToType = __parseInput;
//# sourceMappingURL=base.js.map