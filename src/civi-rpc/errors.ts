export enum APPLICATION_ERROR {
    UNKNOWN_ERROR = -1,

    PARAM_VALIDATION_ERROR = 40001,

    SQL_CREATION_ERROR = 40002,

    SSO_LOGIN_REQUIRED = 40101,

    OPERATION_NOT_ALLOWED = 40301,
    SSO_SUPER_USER_REQUIRED = 40302,

    INTERNAL_RESOURCE_NOT_FOUND = 40401,
    RPC_METHOD_NOT_FOUND = 40402,

    INTERNAL_RESOURCE_ID_CONFLICT = 40901,

    INTERNAL_DATA_CORRUPTION = 42201,
}

const keyExcept = new Set(['status', 'stack', 'message', 'name', 'readableMessage']);
export class ApplicationError extends Error {
    code: string | number;
    status: number;
    readableMessage: string;

    err?: Error;
    [k: string]: any;

    constructor(status: number, detail?: any) {
        super(`ApplicationError: ${status}`);
        this.name = Object.getPrototypeOf(this).constructor.name;
        this.message = `${status}`;
        this.readableMessage = `应用异常: ${status}`;
        this.status = status;
        this.code = status > 1000 ? parseInt(`${status}`.substring(0, 3), 10) : status;

        if (typeof detail === 'object') {
            Object.assign(this, detail || {});
        } else if (typeof detail === 'string') {
            this.message = detail;
        }
        if (this.err?.stack && this.stack) {
            const message_lines = (this.message.match(/\n/g) || []).length + 1;
            this.stack = this.stack.split('\n').slice(0, message_lines + 1).join('\n') +
                '\n\nWhich was derived from:\n\n' +
                this.err.stack;
        }
    }

    toString() {
        return `${this.name}: ${this.status}; \n${JSON.stringify(this.detail)}`;
    }

    get detail() {
        const ownProps = Object.getOwnPropertyNames(this);

        const r: any = {};

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


export class ParamValidationError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.PARAM_VALIDATION_ERROR, detail);
        this.readableMessage = `参数异常(${this.path}): ${this.message}`;
    }
}

export class ResourceNotFoundError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.INTERNAL_RESOURCE_NOT_FOUND, detail);
        this.readableMessage = `未找到资源: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class RPCMethodNotFoundError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.RPC_METHOD_NOT_FOUND, detail);
        this.readableMessage = `未找到方法: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class OperationNotAllowedError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.OPERATION_NOT_ALLOWED, detail);
        this.readableMessage = `无权操作: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class SSOSuperUserRequiredError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.SSO_SUPER_USER_REQUIRED, detail);
        this.readableMessage = `需要超级管理员身份: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class ResourceIdConflictError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.INTERNAL_RESOURCE_ID_CONFLICT, detail);
        this.readableMessage = `资源ID冲突: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class DataCorruptionError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.INTERNAL_DATA_CORRUPTION, detail);
        this.readableMessage = `资源数据损毁: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

