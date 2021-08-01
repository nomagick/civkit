/// <reference types="node" />
import { ChildProcess, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import { Deferred } from './defer';
export declare type CustomSpawnOptions = SpawnOptions & {
    timeout?: number;
    killSignal?: string;
};
export declare class SubProcessRoutine extends EventEmitter {
    cmd: string;
    args: string[];
    currentState: 'init' | 'pending' | 'error' | 'done';
    timeout: number;
    startedOn?: number;
    spawnOptions?: CustomSpawnOptions;
    childProcess?: ChildProcess;
    protected deferred: Deferred<0>;
    returnValue?: number | Error;
    constructor(cmd: string, args: string[], spawnOptions?: CustomSpawnOptions);
    get pid(): number | undefined;
    get stdout(): import("stream").Readable | null | undefined;
    get stderr(): import("stream").Readable | null | undefined;
    get stdin(): import("stream").Writable | null | undefined;
    get promise(): Promise<0>;
    get ttl(): number | undefined;
    start(): void;
    terminate(sig?: string): void;
}
//# sourceMappingURL=subprocess.d.ts.map