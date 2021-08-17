"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResourceIdConflictError = exports.SSOSuperUserRequiredError = exports.OperationNotAllowedError = exports.RPCMethodNotFoundError = exports.ResourceNotFoundError = exports.ParamValidationError = exports.ApplicationError = exports.APPLICATION_ERROR = void 0;
var APPLICATION_ERROR;
(function (APPLICATION_ERROR) {
    APPLICATION_ERROR[APPLICATION_ERROR["UNKNOWN_ERROR"] = -1] = "UNKNOWN_ERROR";
    APPLICATION_ERROR[APPLICATION_ERROR["PARAM_VALIDATION_ERROR"] = 40001] = "PARAM_VALIDATION_ERROR";
    APPLICATION_ERROR[APPLICATION_ERROR["SQL_CREATION_ERROR"] = 40002] = "SQL_CREATION_ERROR";
    APPLICATION_ERROR[APPLICATION_ERROR["SSO_LOGIN_REQUIRED"] = 40101] = "SSO_LOGIN_REQUIRED";
    APPLICATION_ERROR[APPLICATION_ERROR["OPERATION_NOT_ALLOWED"] = 40301] = "OPERATION_NOT_ALLOWED";
    APPLICATION_ERROR[APPLICATION_ERROR["SSO_SUPER_USER_REQUIRED"] = 40302] = "SSO_SUPER_USER_REQUIRED";
    APPLICATION_ERROR[APPLICATION_ERROR["INTERNAL_RESOURCE_NOT_FOUND"] = 40401] = "INTERNAL_RESOURCE_NOT_FOUND";
    APPLICATION_ERROR[APPLICATION_ERROR["RPC_METHOD_NOT_FOUND"] = 40402] = "RPC_METHOD_NOT_FOUND";
    APPLICATION_ERROR[APPLICATION_ERROR["INTERNAL_RESOURCE_ID_CONFLICT"] = 40901] = "INTERNAL_RESOURCE_ID_CONFLICT";
})(APPLICATION_ERROR = exports.APPLICATION_ERROR || (exports.APPLICATION_ERROR = {}));
const keyExcept = new Set(['status', 'stack', 'message', 'name', 'readableMessage']);
class ApplicationError extends Error {
    constructor(status, detail) {
        super(`ApplicationError: ${status}`);
        this.name = Object.getPrototypeOf(this).constructor.name;
        this.message = `${status}`;
        this.readableMessage = `应用异常: ${status}`;
        this.status = status;
        if (typeof detail === 'object') {
            Object.assign(this, detail || {});
        }
        else if (typeof detail === 'string') {
            this.message = detail;
        }
    }
    toString() {
        return `${this.name}: ${this.status}; \n${JSON.stringify(this.detail)}`;
    }
    get detail() {
        const ownProps = Object.getOwnPropertyNames(this);
        const r = {};
        for (const k of ownProps) {
            if (keyExcept.has(k)) {
                continue;
            }
            r[k] = this[k];
        }
        return r;
    }
    toObject() {
        if (!process.env.NODE_ENV?.toLowerCase().includes('dev')) {
            return { name: this.name, status: this.status, data: this.detail };
        }
        return { name: this.name, status: this.status, message: this.message, detail: this.detail, stack: this.stack };
    }
    toJSON() {
        return this.toObject();
    }
}
exports.ApplicationError = ApplicationError;
class ParamValidationError extends ApplicationError {
    constructor(detail) {
        super(APPLICATION_ERROR.PARAM_VALIDATION_ERROR, detail);
        this.readableMessage = `参数异常(${this.path}): ${this.message}`;
    }
}
exports.ParamValidationError = ParamValidationError;
class ResourceNotFoundError extends ApplicationError {
    constructor(detail) {
        super(APPLICATION_ERROR.INTERNAL_RESOURCE_NOT_FOUND, detail);
        this.readableMessage = `未找到资源: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}
exports.ResourceNotFoundError = ResourceNotFoundError;
class RPCMethodNotFoundError extends ApplicationError {
    constructor(detail) {
        super(APPLICATION_ERROR.RPC_METHOD_NOT_FOUND, detail);
        this.readableMessage = `未找到方法: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}
exports.RPCMethodNotFoundError = RPCMethodNotFoundError;
class OperationNotAllowedError extends ApplicationError {
    constructor(detail) {
        super(APPLICATION_ERROR.OPERATION_NOT_ALLOWED, detail);
        this.readableMessage = `无权操作: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}
exports.OperationNotAllowedError = OperationNotAllowedError;
class SSOSuperUserRequiredError extends ApplicationError {
    constructor(detail) {
        super(APPLICATION_ERROR.SSO_SUPER_USER_REQUIRED, detail);
        this.readableMessage = `需要超级管理员身份: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}
exports.SSOSuperUserRequiredError = SSOSuperUserRequiredError;
class ResourceIdConflictError extends ApplicationError {
    constructor(detail) {
        super(APPLICATION_ERROR.INTERNAL_RESOURCE_ID_CONFLICT, detail);
        this.readableMessage = `资源ID冲突: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}
exports.ResourceIdConflictError = ResourceIdConflictError;
//# sourceMappingURL=errors.js.map