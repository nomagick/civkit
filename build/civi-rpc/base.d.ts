import 'reflect-metadata';
import { AsyncService } from '../lib/async-service';
export declare const RPCPARAM_OPTIONS_SYMBOL: unique symbol;
export declare const RPC_CALL_ENVIROMENT: unique symbol;
export declare const NOT_RESOLVED: unique symbol;
export declare class RPCHost extends AsyncService {
    setResultMeta(target: object, metaToSet: object): object;
    getResultMeta(target: object): object | undefined;
}
export declare class RPCParam<T = any> {
    [RPCPARAM_OPTIONS_SYMBOL]: {
        [k: string]: PropOptions<any>;
    };
    [RPC_CALL_ENVIROMENT]?: T;
    static fromObject(input: object): RPCParam<any>;
    static fromContext<T extends object>(ctx: T): RPCParam<any>;
}
export declare const nativeTypes: Set<new (p: any) => any>;
export declare function castToType(ensureTypes: any[], inputProp: any): any;
export declare function inputSingle<T>(host: Function | undefined, input: any, prop: string | symbol, config: PropOptions<T>): any;
export declare type Enum = Set<number | string> | {
    [k: string]: number | string;
    [w: number]: number | string;
};
export interface PropOptions<T> {
    path?: string | symbol;
    type?: any | any[];
    arrayOf?: any | any[];
    validate?: (val: T, obj?: any) => boolean;
    required?: boolean;
    default?: T;
}
//# sourceMappingURL=base.d.ts.map