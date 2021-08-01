"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubProcessRoutine = void 0;
const child_process_1 = require("child_process");
const events_1 = require("events");
const defer_1 = require("./defer");
class SubProcessRoutine extends events_1.EventEmitter {
    constructor(cmd, args, spawnOptions) {
        super();
        this.currentState = 'init';
        this.timeout = 0;
        this.deferred = defer_1.Defer();
        this.cmd = cmd;
        this.args = args || [];
        this.spawnOptions = spawnOptions;
        this.emit('init', { cmd, args, spawnOptions });
    }
    get pid() {
        if (this.childProcess) {
            return this.childProcess.pid;
        }
        else {
            return undefined;
        }
    }
    get stdout() {
        if (this.childProcess) {
            return this.childProcess.stdout;
        }
        else {
            return undefined;
        }
    }
    get stderr() {
        if (this.childProcess) {
            return this.childProcess.stderr;
        }
        else {
            return undefined;
        }
    }
    get stdin() {
        if (this.childProcess) {
            return this.childProcess.stdin;
        }
        else {
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
        this.childProcess = child_process_1.spawn(this.cmd, this.args, this.spawnOptions);
        this.currentState = 'pending';
        this.emit('start', { cmd: this.cmd, args: this.args, spawnOptions: this.spawnOptions, pid: this.pid, process: this.childProcess });
        let timeOutHanele;
        const onExit = (code, signal) => {
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
            this.childProcess.removeListener('exit', onExit);
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
                    this.terminate(this.spawnOptions.killSignal || 'SIGKILL');
                }
                timeOutHanele = null;
            }, this.spawnOptions.timeout);
        }
        this.startedOn = Date.now();
    }
    terminate(sig) {
        if (this.childProcess) {
            this.childProcess.kill(sig);
        }
    }
}
exports.SubProcessRoutine = SubProcessRoutine;
//# sourceMappingURL=subprocess.js.map