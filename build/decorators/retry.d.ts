export declare const TRIES_SYMBOL: unique symbol;
export declare function patchRetry<T extends Function>(func: T, maxTries: number, delayInMs?: number): T;
export declare function retry(maxTries: number, delayInMs?: number): (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) => PropertyDescriptor;
//# sourceMappingURL=retry.d.ts.map