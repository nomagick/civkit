export interface Deferred<T> {
    promise: Promise<T>;
    resolve: (data?: T | Promise<T> | void) => void;
    reject: (err?: any | void) => void;
}
export declare function Defer<T = any>(): Deferred<T>;
export declare class TimeoutError extends Error {
    code: string;
}
export declare function TimedDefer<T = any>(timeout?: number): Deferred<T>;
export interface GCProofDeferred<T> extends Promise<T> {
    __resolve: (v: any) => void;
    __reject: (v: any) => void;
}
export declare function GCProofDefer<T = any>(): GCProofDeferred<T>;
//# sourceMappingURL=defer.d.ts.map