/* eslint-disable @typescript-eslint/no-magic-numbers */
import { get } from 'lodash';
import {
    AutoCastable, Prop, autoConstructor, Also
} from '../lib/auto-castable';
import {
    assignTransferProtocolMeta, extractTransferProtocolMeta,
    RPC_TRANSFER_PROTOCOL_META_SYMBOL, RPC_MARSHAL
} from './meta';

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
    SECURITY_INSPECTION_REQUIRED = 40303,
    ACCOUNT_SUSPENDED = 40304,

    INTERNAL_RESOURCE_NOT_FOUND = 40401,
    RPC_METHOD_NOT_FOUND = 40402,
    REQUESTED_ENTITY_NOT_FOUND = 40403,

    INTERNAL_RESOURCE_METHOD_NOT_ALLOWED = 40501,
    INCOMPATIBLE_METHOD_ERROR = 40502,

    TIMEOUT_EXPECTING_EVENT = 40801,
    TIMEOUT_EXPECTING_TASK_COMPLETE = 40802,

    INTERNAL_RESOURCE_ID_CONFLICT = 40901,
    RESOURCE_POLICY_DENY = 40902,

    REQUEST_PAYLOAD_TOO_LARGE = 41301,

    INTERNAL_DATA_CORRUPTION = 42201,
    IDENTIFIER_NAMESPACE_OCCUPIED = 42202,
    SUBMITTED_DATA_MALFORMED = 42203,
    EXTERNAL_SERVICE_FAILURE = 42204,
    DOWNSTREAM_SERVICE_FAILURE = 42205,
    ASSERTION_FAILURE = 42206,

    TOO_MANY_REQUESTS = 42901,
    TOO_MANY_TRIES = 42902,

    SERVER_INTERNAL_ERROR = 50001,
    DOWNSTREAM_SERVICE_ERROR = 50002,
    SERVER_SUBPROCESS_ERROR = 50003,
    SANDBOX_BUILD_NOT_FOUND = 50004,
    NOT_IMPLEMENTED_ERROR = 50005,
    RESPONSE_STREAM_CLOSED = 50006,

    NO_APPROPRIATE_X509_CERTIFICATE_ERROR = 50102,
}

const keyExcept = new Set(['status', 'stack', 'message', 'name', 'readableMessage']);

export function StatusCode(status: APPLICATION_ERROR | number) {
    return function statusCodeDecorator<T extends typeof ApplicationError>(tgt: T) {
        const code = (status) > 1000 ? parseInt(`${status}`.substring(0, 3), 10) : status;
        Object.defineProperty(tgt.prototype, 'status', {
            value: status,
            writable: true,
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(tgt.prototype, 'code', {
            value: code,
            writable: true,
            enumerable: true,
            configurable: true
        });

        Prop({
            type: String,
            desc: 'Name of the error class',
            default: tgt.constructor.name,
            required: true,
            openapi: { omitted: true }
        })(tgt.prototype, 'name');

        Prop({
            type: Number,
            desc: 'Expect HTTP response codes',
            default: code,
            required: true,
        })(tgt.prototype, 'code');

        Prop({
            type: Number,
            desc: 'Application status code for the error in extension to HTTP status codes',
            default: status,
            required: true,
        })(tgt.prototype, 'status');

        return;
    };
}

@Also({
    dictOf: Object
})
@StatusCode(50000)
export class ApplicationError extends Error implements AutoCastable {
    static from(input: string | object) {
        let _input = input;
        if (typeof input === 'string') {
            _input = { message: input };
        }
        const instance = autoConstructor.call(this, _input) as ApplicationError;

        Error.captureStackTrace(instance, this.from);
        instance._fixStack();

        return instance;
    }

    protected get [RPC_TRANSFER_PROTOCOL_META_SYMBOL]() {
        return {
            code: this.code,
            status: this.status,
            contentType: 'application/json',
        };
    }

    @Prop({
        required: true
    })
    override name: string;

    @Prop({
        required: true
    })
    override message: string;

    @Prop({
        openapi: { omitted: true }
    })
    override stack!: string;

    @Prop({
        type: Number,
        required: true
    })
    code!: string | number;

    @Prop({
        required: true
    })
    status!: number;

    @Prop()
    readableMessage: string;

    @Prop({
        openapi: { omitted: true }
    })
    override cause?: unknown;

    [k: string]: any;

    get error() {
        return this.cause as any;
    }

    set error(err: Error | undefined) {
        this.cause = err;
    }

    get err() {
        return this.cause as any;
    }

    set err(err: Error | undefined) {
        this.cause = err;
    }

    constructor(detail?: any) {
        super();
        this.name = Object.getPrototypeOf(this).constructor.name;
        this.message = `${this.status}`;

        if (typeof detail === 'object') {
            if (detail instanceof Error) {
                this.error = detail;
            }
            Object.assign(this, detail || {});

        } else if (typeof detail === 'string') {
            this.message = detail;
        }

        if (this.hasOwnProperty('status')) {
            this.code = (this.status) > 1000 ? parseInt(`${this.status}`.substring(0, 3), 10) : this.status;
        }

        if (typeof detail === 'object' && detail.readableMessage) {
            this.readableMessage = `${this.name}: ${detail.readableMessage}`;
        } else {
            this.readableMessage = `${this.name}: ${this.message}`;
        }

        this._fixStack();
    }

    _fixStack() {
        if ((typeof get(this.cause, 'stack') === 'string') && this.stack) {
            const message_lines = (this.message.match(/\n/g) || []).length + 1;
            this.stack = this.stack.split('\n').slice(0, message_lines + 1).join('\n') +
                '\n\nWhich was derived from:\n\n' +
                (this.cause as Error).stack;
        }
    }

    override toString() {
        return `${this.name}: ${this.status}; ${this.message || JSON.stringify(this.detail)}`;
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
        if (process.env.NODE_ENV?.toLowerCase().includes('dev')) {
            return {
                ...this.detail,
                code: this.code,
                name: this.name,
                status: this.status,
                message: this.message,
                readableMessage: this.readableMessage,
                stack: this.stack
            };
        }

        return {
            ...this.detail,
            code: this.code,
            name: this.name,
            status: this.status,
            message: this.message,
            readableMessage: this.readableMessage,
        };
    }

    toJSON() {
        return this.toObject();
    }

    [RPC_MARSHAL]() {
        const exportObj = this.toObject();
        return assignTransferProtocolMeta(
            {
                data: null,
                ...exportObj
            },
            extractTransferProtocolMeta(this)
        );
    }
}

@StatusCode(APPLICATION_ERROR.PARAM_VALIDATION_ERROR)
export class ParamValidationError extends ApplicationError {
    constructor(detail?: any) {
        super(detail);
        if (detail.readableMessage) {
            this.readableMessage = `${this.name}(${this.path}): ${detail.readableMessage}`;
        } else {
            this.readableMessage = `${this.name}(${this.path}): ${this.message}`;
        }
    }
}

@StatusCode(APPLICATION_ERROR.AUTHENTICATION_FAILED)
export class AuthenticationFailedError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.AUTHENTICATION_REQUIRED)
export class AuthenticationRequiredError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.INTERNAL_RESOURCE_NOT_FOUND)
export class ResourceNotFoundError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.RPC_METHOD_NOT_FOUND)
export class RPCMethodNotFoundError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.REQUESTED_ENTITY_NOT_FOUND)
export class RequestedEntityNotFoundError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.INTERNAL_RESOURCE_METHOD_NOT_ALLOWED)
export class ResourceMethodNotAllowedError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.INCOMPATIBLE_METHOD_ERROR)
export class IncompatibleMethodError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.TIMEOUT_EXPECTING_EVENT)
export class TimeoutExpectingEventError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.TIMEOUT_EXPECTING_TASK_COMPLETE)
export class TimeoutExpectingTaskCompleteError extends ApplicationError { }


@StatusCode(APPLICATION_ERROR.OPERATION_NOT_ALLOWED)
export class OperationNotAllowedError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.SECURITY_INSPECTION_REQUIRED)
export class SecurityInspectionRequiredError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.ACCOUNT_SUSPENDED)
export class AccountSuspendedError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.ASSERTION_FAILURE)
export class AssertionFailureError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.TOO_MANY_REQUESTS)
export class TooManyRequestsError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.TOO_MANY_TRIES)
export class TooManyTriesError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.INTERNAL_RESOURCE_ID_CONFLICT)
export class ResourceIdConflictError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.RESOURCE_POLICY_DENY)
export class ResourcePolicyDenyError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.INTERNAL_DATA_CORRUPTION)
export class DataCorruptionError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.DATA_STREAM_BROKEN_ERROR)
export class DataStreamBrokenError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.UNEXPECTED_MIME_TYPE_ERROR)
export class UnexpectedMimeTypeError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.DOWNSTREAM_SERVICE_ERROR)
export class DownstreamServiceError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.SERVER_SUBPROCESS_ERROR)
export class ServerSubprocessError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.SERVER_INTERNAL_ERROR)
export class InternalServerError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.NOT_IMPLEMENTED_ERROR)
export class NotImplementedError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.NO_APPROPRIATE_X509_CERTIFICATE_ERROR)
export class NoAppropriateX509CertificateError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.IDENTIFIER_NAMESPACE_OCCUPIED)
export class IdentifierNamespaceOccupiedError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.EXTERNAL_SERVICE_FAILURE)
export class ExternalServiceFailureError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.DOWNSTREAM_SERVICE_FAILURE)
export class DownstreamServiceFailureError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.SUBMITTED_DATA_MALFORMED)
export class SubmittedDataMalformedError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.REQUEST_PAYLOAD_TOO_LARGE)
export class RequestPayloadTooLargeError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.SANDBOX_BUILD_NOT_FOUND)
export class SandboxBuildNotFoundError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.RESPONSE_STREAM_CLOSED)
export class ResponseStreamClosedError extends ApplicationError { }

@StatusCode(APPLICATION_ERROR.SSO_SUPER_USER_REQUIRED)
export class SSOSuperUserRequiredError extends ApplicationError { }
