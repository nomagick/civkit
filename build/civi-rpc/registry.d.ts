import { RPCHost, RPCParam } from './base';
import { AsyncService } from '../lib/async-service';
import type { container as DIContainer } from 'tsyringe';
export interface RPCOptions {
    name: string | string[];
    paramTypes?: Array<typeof RPCParam>;
    http?: {
        action?: string | string[];
        path?: string;
    };
    host?: any;
    hostProto?: any;
    nameOnProto?: any;
    method?: Function;
}
export declare const PICK_RPC_PARAM_DECORATION_META_KEY = "PickPram";
export declare const RPC_CALL_ENVIROMENT: unique symbol;
export declare abstract class AbstractRPCRegistry extends AsyncService {
    private __tick;
    abstract container: typeof DIContainer;
    conf: Map<string, RPCOptions>;
    wrapped: Map<string, Function>;
    httpSignature: Map<string, string>;
    constructor();
    init(): void;
    register(options: RPCOptions): Function | undefined;
    wrapRPCMethod(name: string): Function | undefined;
    dump(): [string[], Function, RPCOptions][];
    decorators(): {
        RPCMethod: (options?: Partial<RPCOptions> | string) => (tgt: typeof RPCHost.prototype, methodName: string) => void;
        Pick: (path?: string | symbol | ((ctx: object) => any) | undefined) => (tgt: typeof RPCHost.prototype, methodName: string, paramIdx: number) => void;
    };
}
export declare function makeRPCKit(container: typeof DIContainer): typeof AbstractRPCRegistry;
//# sourceMappingURL=registry.d.ts.map