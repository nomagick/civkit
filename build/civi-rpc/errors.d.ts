export declare enum APPLICATION_ERROR {
    UNKNOWN_ERROR = -1,
    PARAM_VALIDATION_ERROR = 40001,
    SQL_CREATION_ERROR = 40002,
    SSO_LOGIN_REQUIRED = 40101,
    OPERATION_NOT_ALLOWED = 40301,
    SSO_SUPER_USER_REQUIRED = 40302,
    INTERNAL_RESOURCE_NOT_FOUND = 40401,
    RPC_METHOD_NOT_FOUND = 40402,
    INTERNAL_RESOURCE_ID_CONFLICT = 40901
}
export declare class ApplicationError extends Error {
    status: APPLICATION_ERROR;
    [k: string]: any;
    constructor(status: APPLICATION_ERROR, detail?: any);
    toString(): string;
    get detail(): any;
    toObject(): {
        name: string;
        status: APPLICATION_ERROR;
        data: any;
        message?: undefined;
        detail?: undefined;
        stack?: undefined;
    } | {
        name: string;
        status: APPLICATION_ERROR;
        message: string;
        detail: any;
        stack: string | undefined;
        data?: undefined;
    };
    toJSON(): {
        name: string;
        status: APPLICATION_ERROR;
        data: any;
        message?: undefined;
        detail?: undefined;
        stack?: undefined;
    } | {
        name: string;
        status: APPLICATION_ERROR;
        message: string;
        detail: any;
        stack: string | undefined;
        data?: undefined;
    };
}
export declare class ParamValidationError extends ApplicationError {
    constructor(detail?: any);
}
export declare class ResourceNotFoundError extends ApplicationError {
    constructor(detail?: any);
}
export declare class RPCMethodNotFoundError extends ApplicationError {
    constructor(detail?: any);
}
export declare class OperationNotAllowedError extends ApplicationError {
    constructor(detail?: any);
}
export declare class SSOSuperUserRequiredError extends ApplicationError {
    constructor(detail?: any);
}
export declare class ResourceIdConflictError extends ApplicationError {
    constructor(detail?: any);
}
//# sourceMappingURL=errors.d.ts.map