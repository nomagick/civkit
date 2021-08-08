/// <reference types="node" />
import { EventEmitter } from 'events';
export declare abstract class AsyncService extends EventEmitter {
    protected __serviceReady: Promise<this>;
    protected __dependencies: AsyncService[];
    protected __status: 'ready' | 'revoked' | 'pending';
    constructor(...argv: AsyncService[]);
    init(): any;
    get serviceReady(): Promise<this>;
    get dependencyReady(): Promise<AsyncService[]>;
}
//# sourceMappingURL=async-service.d.ts.map