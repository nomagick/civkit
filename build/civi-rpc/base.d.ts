import 'reflect-metadata';
import AsyncService from '../lib/async-service';
export declare const RPCPARAM_OPTIONS_SYMBOL: unique symbol;
export declare const NOT_RESOLVED: unique symbol;
export declare class RPCHost extends AsyncService {
    setResultMeta(target: object, metaToSet: object): object;
    getResultMeta(target: object): object | undefined;
}
export declare class RPCParam {
    [RPCPARAM_OPTIONS_SYMBOL]: {
        [k: string]: PropOptions<any>;
    };
    static fromObject(input: object): RPCParam;
    static fromContext<T extends object>(ctx: T): RPCParam;
}
declare function __parseInput(ensureTypes: any[], inputProp: any): any;
export declare const castToType: typeof __parseInput;
export declare type Enum = Set<number | string> | {
    [k: string]: number | string;
    [w: number]: number | string;
};
export interface PropOptions<T> {
    path?: string;
    type?: (new () => T) | Array<(new () => T) | Enum | null> | Enum | null;
    arrayOf?: (new () => T) | Array<(new () => T) | Enum | null> | Enum | null;
    validate?: (val: T, obj?: any) => boolean;
    required?: boolean;
    default?: T;
}
export {};
//# sourceMappingURL=base.d.ts.map