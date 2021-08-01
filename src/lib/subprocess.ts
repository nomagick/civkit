import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import { Defer, Deferred } from './defer';

export type CustomSpawnOptions = SpawnOptions & {
    timeout?: number;
    killSignal?: string;
};

export class SubProcessRoutine extends EventEmitter {
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
        this.spawnOptions = spawnOptions;
        this.emit('init', { cmd, args, spawnOptions });
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
        this.childProcess = spawn(this.cmd, this.args, this.spawnOptions as SpawnOptions);
        this.currentState = 'pending';
        this.emit('start', { cmd: this.cmd, args: this.args, spawnOptions: this.spawnOptions, pid: this.pid, process: this.childProcess });

        let timeOutHanele: any;
        const onExit = (code: number, signal: string) => {
            if (code === 0) {
                this.currentState = 'done';
                this.returnValue = 0;
                this.deferred.resolve(0);

                this.emit('done', { cmd: this.cmd, args: this.args, spawnOptions: this.spawnOptions, pid: this.pid, code, signal, process: this.childProcess });

                return;
            }
            if (timeOutHanele) {
                clearTimeout(timeOutHanele);
            }
            this.currentState = 'error';
            this.returnValue = code || new Error(signal);
            this.deferred.reject(this.returnValue);

            this.emit('error', { cmd: this.cmd, args: this.args, spawnOptions: this.spawnOptions, pid: this.pid, code, signal, process: this.childProcess });
        };
        this.childProcess.once('exit', onExit);
        this.childProcess.once('error', (err) => {
            this.currentState = 'error';
            this.returnValue = err;
            this.childProcess!.removeListener('exit', onExit);
            if (timeOutHanele) {
                clearTimeout(timeOutHanele);
            }
            this.terminate();

            this.deferred.reject(err);

            this.emit('error', { cmd: this.cmd, args: this.args, spawnOptions: this.spawnOptions, pid: this.pid, err, process: this.childProcess });
        });
        if (this.spawnOptions && this.spawnOptions.timeout) {
            this.timeout = this.spawnOptions.timeout;
            timeOutHanele = setTimeout(() => {
                if (this.currentState === 'pending') {
                    this.terminate(this.spawnOptions!.killSignal || 'SIGKILL');
                }
                timeOutHanele = null;
            }, this.spawnOptions.timeout);
        }
        this.startedOn = Date.now();
    }

    terminate(sig?: string) {
        if (this.childProcess) {
            this.childProcess.kill(sig as 'SIGTERM');
        }
    }

}
