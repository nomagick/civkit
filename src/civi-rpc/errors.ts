export enum APPLICATION_ERROR {
    UNKNOWN_ERROR = -1,

    PARAM_VALIDATION_ERROR = 40001,

    SQL_CREATION_ERROR = 40002,
    DATA_STREAM_BROKEN_ERROR = 40003,
    UNEXPECTED_MIME_TYPE_ERROR = 40004,

    SSO_LOGIN_REQUIRED = 40101,
    AUTHENTICATION_FAILED = 40102,
    AUTHENTICATION_REQUIRED = 40103,

    OPERATION_NOT_ALLOWED = 40301,
    SSO_SUPER_USER_REQUIRED = 40302,

    INTERNAL_RESOURCE_NOT_FOUND = 40401,
    RPC_METHOD_NOT_FOUND = 40402,
    REQUESTED_ENTITY_NOT_FOUND = 40403,

    INTERNAL_RESOURCE_METHOD_NOT_ALLOWED = 40501,
    INCOMPATIBLE_METHOD_ERROR = 40502,

    INTERNAL_RESOURCE_ID_CONFLICT = 40901,

    REQUEST_PAYLOAD_TOO_LARGE = 41301,

    INTERNAL_DATA_CORRUPTION = 42201,
    IDENTIFIER_NAMESPACE_OCCUPIED = 42202,
    SUBMITTED_DATA_MALFORMED = 42203,
    EXTERNAL_SERVICE_FAILURE = 42204,

    SERVER_INTERNAL_ERROR = 50001,
    DOWNSTREAM_SERVICE_ERROR = 50002,
    SERVER_SUBPROCESS_ERROR = 50003,
    SANDBOX_BUILD_NOT_FOUND = 50004,
    NOT_IMPLEMENTED_ERROR = 50005,
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
        this.readableMessage = `ApplicationError: ${status}`;
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
        this.readableMessage = `ParamValidationError(${this.path}): ${this.message}`;
    }
}

export class AuthenticationFailedError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.AUTHENTICATION_FAILED, detail);
        this.readableMessage = `AuthenticationFailedError: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class AuthenticationRequiredError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.AUTHENTICATION_REQUIRED, detail);
        this.readableMessage = `AuthenticationRequiredError: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class ResourceNotFoundError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.INTERNAL_RESOURCE_NOT_FOUND, detail);
        this.readableMessage = `InternalResourceNotFound: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class RPCMethodNotFoundError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.RPC_METHOD_NOT_FOUND, detail);
        this.readableMessage = `RPCMethodNotFound: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class RequestedEntityNotFoundError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.REQUESTED_ENTITY_NOT_FOUND, detail);
        this.readableMessage = `RequestedEntityNotFoundError: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class ResourceMethodNotAllowedError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.INTERNAL_RESOURCE_METHOD_NOT_ALLOWED, detail);
        this.readableMessage = `ResourceMethodNotAllowed: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class IncompatibleMethodError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.INCOMPATIBLE_METHOD_ERROR, detail);
        this.readableMessage = `IncompatibleMethodError: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}


export class OperationNotAllowedError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.OPERATION_NOT_ALLOWED, detail);
        this.readableMessage = `OperationNotAllowed: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class SSOSuperUserRequiredError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.SSO_SUPER_USER_REQUIRED, detail);
        this.readableMessage = `SSOSuperUserRequired: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class ResourceIdConflictError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.INTERNAL_RESOURCE_ID_CONFLICT, detail);
        this.readableMessage = `InternalResourceIDConflict: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class DataCorruptionError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.INTERNAL_DATA_CORRUPTION, detail);
        this.readableMessage = `InternalDataCorruption: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class DataStreamBrokenError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.DATA_STREAM_BROKEN_ERROR, detail);
        this.readableMessage = `DataStreamBroken: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class DownstreamServiceError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.DOWNSTREAM_SERVICE_ERROR, detail);
        this.readableMessage = `DownstreamServiceError: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}
export class ServerSubprocessError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.SERVER_SUBPROCESS_ERROR, detail);
        this.readableMessage = `ServerSubprocessError: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class InternalServerError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.SERVER_INTERNAL_ERROR, detail);
        this.readableMessage = `ServerInternalError: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class NotImplementedError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.NOT_IMPLEMENTED_ERROR, detail);
        this.readableMessage = `NotImplementedError: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class IdentifierNamespaceOccupiedError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.IDENTIFIER_NAMESPACE_OCCUPIED, detail);
        this.readableMessage = `IdentifierNamespaceOccupiedError: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class ExternalServiceFailureError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.EXTERNAL_SERVICE_FAILURE, detail);
        this.readableMessage = `ExternalServiceFailureError: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class SubmittedDataMalformedError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.SUBMITTED_DATA_MALFORMED, detail);
        this.readableMessage = `SubmittedDataMalformedError: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}

export class RequestPayloadTooLargeError extends ApplicationError {
    constructor(detail?: any) {
        super(APPLICATION_ERROR.REQUEST_PAYLOAD_TOO_LARGE, detail);
        this.readableMessage = `RequestPayloadTooLarge: ${this.message} ${JSON.stringify(this.detail)}`;
    }
}
