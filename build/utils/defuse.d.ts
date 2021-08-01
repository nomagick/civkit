export declare function defuse<T>(promise: Promise<T>): Promise<unknown>;
export declare type Defuse<T> = {
    [P in keyof T]: T[P] extends Promise<infer L> ? Promise<L | null> : T[P];
};
export declare function defuseObj<T extends object>(obj: T): Defuse<T>;
export declare type SafeAwait<T> = {
    [P in keyof T]: T[P] extends Promise<infer L> ? L : T[P];
};
export declare function safeAwaitObj<T extends object>(obj: T): Promise<SafeAwait<T>>;
export declare function awaitObj<T extends object>(obj: T): Promise<SafeAwait<T>>;
//# sourceMappingURL=defuse.d.ts.map