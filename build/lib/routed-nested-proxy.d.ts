/// <reference types="node" />
import { EventEmitter } from 'events';
export declare function isNative(obj: any): boolean;
export interface RoutedProxyHandler<T extends object> {
    getPrototypeOf?(target: T, routes: string[]): object | null;
    setPrototypeOf?(target: T, v: any, routes: string[]): boolean;
    isExtensible?(target: T, routes: string[]): boolean;
    preventExtensions?(target: T, routes: string[]): boolean;
    getOwnPropertyDescriptor?(target: T, p: PropertyKey, routes: string[]): PropertyDescriptor | undefined;
    has?(target: T, p: PropertyKey, routes: string[]): boolean;
    get?(target: T, p: PropertyKey, receiver: any, routes: string[]): any;
    set?(target: T, p: PropertyKey, value: any, receiver: any, routes: string[]): boolean | undefined;
    deleteProperty?(target: T, p: PropertyKey, routes: string[]): boolean | undefined;
    defineProperty?(target: T, p: PropertyKey, attributes: PropertyDescriptor, routes: string[]): boolean;
    enumerate?(target: T, routes: string[]): PropertyKey[];
    ownKeys?(target: T, routes: string[]): PropertyKey[];
    apply?(target: T, thisArg: any, argArray?: any, routes?: string[]): any;
    construct?(target: T, argArray: any, newTarget?: any, routes?: string[]): object;
}
export interface UpdateEvent<T = any, P = any> {
    routes: string[];
    key: string;
    target: T;
    targetProxy?: T;
    newVal: P;
    newValProxy?: P;
    oldVal: P;
    oldValProxy?: P;
}
export interface DropEvent<T = any, P = any> {
    routes: string[];
    key: string;
    target: T;
    targetProxy?: T;
    oldVal: P;
    oldValProxy?: P;
}
export interface AttachEvent<T = any> {
    routes: string[];
    target: T;
    targetProxy?: T;
}
export interface DetachEvent<T = any> {
    routes: string[];
    target: T;
    targetProxy?: T;
}
export interface ProxyEventEmitter<T> extends EventEmitter {
    on(event: 'attached', listener: (event: AttachEvent<T>) => any): this;
    on(event: 'detached', listener: (event: DetachEvent<T>) => any): this;
    on(event: 'update', listener: (event: UpdateEvent<T>) => any): this;
    on(event: 'drop', listener: (event: DropEvent<T>) => any): this;
}
export declare function isPositiveInt(dig: any): boolean;
export declare function routeJoin(tgt: any, path: string, key: string): string;
export declare function routedNestedProxy<T extends {
    [k: string]: any;
}>(target: T, handlers: RoutedProxyHandler<T>, deproxySymbol?: symbol): {
    proxy: any;
    proxyMap: WeakMap<object, any>;
    getRoutes: (tgt: object) => string[];
    routeTrack: WeakMap<Object, Set<string>>;
    emitter: ProxyEventEmitter<T>;
    deproxy: (obj: any) => any;
};
export default routedNestedProxy;
//# sourceMappingURL=routed-nested-proxy.d.ts.map