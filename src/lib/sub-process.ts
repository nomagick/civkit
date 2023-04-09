import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import { Defer, Deferred } from './defer';

export type CustomSpawnOptions = SpawnOptions & {
    timeout?: number;
    killSignal?: string;
};

export class SubProcessRoutine extends EventEmitter {
    static Error: { new(...args: any[]): Error; } = Error;

    cmd: string;
    args: string[];
    currentState: 'init' | 'pending' | 'error' | 'done' = 'init';
    timeout: number = 0;
    startedOn?: number;
    spawnOptions?: CustomSpawnOptions;
    childProcess?: ChildProcess;

    protected deferred: Deferred<0> = Defer();

    returnValue?: number | Error;

    constructor(cmd: string, args: string[], spawnOptions?: CustomSpawnOptions) {
        super();
        this.cmd = cmd;
        this.args = args || [];
        this.spawnOptions = { ...spawnOptions };
        // dont crash the parent process
        this.on('error', () => 0);
        this.emit('init', { cmd, args, spawnOptions: this.spawnOptions });
    }

    get pid() {
        if (this.childProcess) {
            return this.childProcess.pid;
        } else {
            return undefined;
        }
    }

    get stdout() {
        if (this.childProcess) {
            return this.childProcess.stdout;
        } else {
            return undefined;
        }
    }
    get stderr() {
        if (this.childProcess) {
            return this.childProcess.stderr;
        } else {
            return undefined;
        }
    }
    get stdin() {
        if (this.childProcess) {
            return this.childProcess.stdin;
        } else {
            return undefined;
        }
    }
    get promise() {
        return this.deferred.promise;
    }

    get ttl() {
        if (this.timeout && this.startedOn) {
            return Date.now() - (this.startedOn + this.timeout);
        }
        return undefined;
    }

    start() {
        if (this.currentState === 'pending') {
            throw new Error('Overlapping process start');
        }
        // Note that spawnOptions is shallow cloned to avoid `env` being set to the object.
        this.childProcess = spawn(this.cmd, this.args, { ...this.spawnOptions } as SpawnOptions);
        this.currentState = 'pending';
        this.emit('start', {
            cmd: this.cmd,
            args: this.args,
            spawnOptions: this.spawnOptions,
            pid: this.pid
        });

        let timeOutHandle: any;
        const onExit = () => {
            if (timeOutHandle) {
                clearTimeout(timeOutHandle);
            }
        };
        const onClose = (code: number, signal: string) => {
            if (code === 0) {
                this.currentState = 'done';
                this.returnValue = 0;
                this.deferred.resolve(0);

                this.emit('done', {
                    cmd: this.cmd,
                    args: this.args,
                    spawnOptions: this.spawnOptions,
                    pid: this.pid,
                    code,
                    signal
                });

                return;
            }
            this.currentState = 'error';
            this.returnValue = code || new Error(signal);

            const err = new (this.constructor as typeof SubProcessRoutine).Error(
                code ? `Process(${this.cmd}) exited on non-zero code: ${code}` : `Process(${this.cmd}) exited on signal: ${signal}`
            );

            Object.assign(err, {
                cmd: this.cmd,
                args: this.args,
                spawnOptions: this.spawnOptions,
                pid: this.pid,
                cpid: this.pid,
                code,
                signal
            });

            this.deferred.reject(err);
            this.emit('error', err, 'exit');
        };
        this.childProcess.once('close', onClose);
        this.childProcess.once('exit', onExit);
        this.childProcess.once('error', (err) => {
            this.currentState = 'error';
            this.returnValue = err;
            this.childProcess!.removeListener('exit', onExit);
            this.childProcess!.removeListener('close', onClose);
            if (timeOutHandle) {
                clearTimeout(timeOutHandle);
            }
            this.terminate();

            this.deferred.reject(err);
            Object.assign(err, {
                cmd: this.cmd,
                args: this.args,
                spawnOptions: this.spawnOptions,
                pid: this.pid,
                cpid: this.pid,
            });

            this.emit('error', err);
        });
        if (this.spawnOptions && this.spawnOptions.timeout) {
            this.timeout = this.spawnOptions.timeout;
            timeOutHandle = setTimeout(() => {
                if (this.currentState === 'pending') {
                    this.terminate(this.spawnOptions!.killSignal || 'SIGKILL');
                }
                timeOutHandle = null;
            }, this.spawnOptions.timeout);
        }
        this.startedOn = Date.now();
    }

    terminate(sig?: string) {
        if (this.childProcess?.exitCode === null) {
            this.childProcess.kill(sig as 'SIGTERM');
        }
    }
}


export interface SubProcessRoutine {
    on(event: 'start', cb: (info: {
        cmd: string,
        args: string[],
        spawnOptions?: CustomSpawnOptions,
        pid: number,
    }) => void): this;
    on(event: 'done', cb: (info: {
        cmd: string,
        args: string[],
        spawnOptions?: CustomSpawnOptions,
        pid: number,
        code: number,
        signal: string,
    }) => void): this;
    on(event: 'error', cb: (info: {
        cmd: string,
        args: string[],
        spawnOptions?: CustomSpawnOptions,
        pid?: number,
        code?: number,
        signal?: string,
        err?: Error;
    }) => void): this;

    on(event: string | symbol, listener: (...args: any[]) => void): this;
}
