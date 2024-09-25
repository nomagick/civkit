import fs from 'fs';

import { SubProcessRoutine, CustomSpawnOptions } from '../lib/sub-process';
import { LoggerInterface } from '../lib/logger';

import { ChildProcess } from 'child_process';
import { ServerSubprocessError } from '../civ-rpc/errors';

export interface AppSpawnOptions extends CustomSpawnOptions {
    debug?: boolean;
    encoding?: BufferEncoding | null;

    pipeStdoutToFile?: string;
    pipeStderrToFile?: string;
}

export abstract class AbstractSubProcess extends SubProcessRoutine {
    static override Error = ServerSubprocessError;

    protected abstract logger: LoggerInterface;

    encoding: BufferEncoding | null = null;

    stdoutTextChunks?: string[];
    stderrTextChunks?: string[];

    constructor(
        cmd: string, args: any[],
        protected options: AppSpawnOptions & { encoding: BufferEncoding | null; } = { encoding: 'utf-8' }
    ) {
        super(cmd, args, options);

        if (options.debug) {
            options.encoding = options.encoding || 'utf-8';

            this.on('line', (line, source) => {
                this.logger.debug(`${source}#${this.childProcess?.pid}> ${line}`);
            });
        }

        this.encoding = options.encoding;

        this.on('start', () => {
            this.logger.debug(`Subprocess '${this.cmd}' started with pid: ${this.pid}`, { cmd, cpid: this.pid, options });
            if (this.options.debug) {
                this.logger.debug(`Commandline: ${cmd} ${args.join(' ')}`);
            }

            this.proxyOutput();
        });

        this.on('done', () => {
            this._flushLines();
            this.emit('end');
            const nowTs = Date.now();
            const ttl = Date.now() - (this.startedOn || nowTs);
            this.logger.debug(`Subprocess '${this.cmd}'(${this.pid}) successfully ended.`, { cmd, cpid: this.pid, ttl });
        });

        this.on('error', (result, source?: string) => {
            const nowTs = Date.now();
            const ttl = Date.now() - (this.startedOn || nowTs);

            this._flushLines();
            this.emit('end');

            if (source === 'exit' && result.code) {
                this.logger.warn(`Process(${this.pid}) quit with code: ${result.code}`, { cpid: this.pid, ttl: ttl });

                return;
            } else if (source === 'exit' && result.signal) {
                this.logger.warn(`Process(${this.pid}) was killed with signal: ${result.signal}`, { cpid: this.pid, ttl: ttl });

                return;
            }

            this.logger.error('Process error', { err: result, cpid: this.pid, ttl });
        });

        // Avoid uncaught promise rejection.
        this.promise.catch(() => 0);

        if (this.encoding) {
            this.stdoutTextChunks = [];
            this.stderrTextChunks = [];

            this.on('text', (text, source) => {
                let textChunks: string[] | undefined;

                if (source === 'stdout') {
                    textChunks = this.stdoutTextChunks;
                } else if (source === 'stderr') {
                    textChunks = this.stderrTextChunks;
                }

                if (!textChunks) {
                    return;
                }

                const lines = [...textChunks, text].join('').split(/\r?\n/g);
                if (lines.length <= 1) {
                    if (text) {
                        textChunks.push(text);
                    }

                    return;
                }
                textChunks.length = 0;
                const lastChunk = lines.pop();
                if (lastChunk) {
                    textChunks.push(lastChunk);
                }

                lines.forEach((x) => {
                    this.emit('line', x, source);
                });
            });
        }
    }

    proxyOutput() {
        if (!this.childProcess) {
            return;
        }

        const stdoutListener = (chunk: Buffer | string) => {
            if ((chunk as Buffer).byteLength) {
                this.emit('chunk', chunk, 'stdout');
            } else if (chunk.length) {
                this.emit('text', chunk, 'stdout');
            }
            this.emit('data', chunk, 'stdout');
        };

        const stderrListener = (chunk: Buffer | string) => {
            if ((chunk as Buffer).byteLength) {
                this.emit('chunk', chunk, 'stderr');
            } else if (chunk.length) {
                this.emit('text', chunk, 'stderr');
            }
            this.emit('data', chunk, 'stderr');
        };

        if (this.childProcess.stdout) {
            if (this.encoding) {
                this.childProcess.stdout.setEncoding(this.encoding);
            }
            this.childProcess.stdout.on('data', stdoutListener);
            this.childProcess.stdout.once('end', () => {
                this.childProcess!.stdout!.removeListener('data', stdoutListener);
                if (this.stdoutTextChunks?.length) {
                    this.emit('line', this.stdoutTextChunks.join(''), 'stdout');
                }
            });
            if (this.options.pipeStdoutToFile) {
                const targetStream = fs.createWriteStream(this.options.pipeStdoutToFile, { flags: 'w' });
                this.childProcess.stdout.pipe(targetStream);
            }
        }

        if (this.childProcess.stderr) {
            if (this.encoding) {
                this.childProcess.stderr.setEncoding(this.encoding);
            }
            this.childProcess.stderr.on('data', stderrListener);
            this.childProcess.stderr.once('end', () => {
                this.childProcess!.stderr!.removeListener('data', stderrListener);
                if (this.stderrTextChunks?.length) {
                    this.emit('line', this.stderrTextChunks.join(''), 'stderr');
                }
            });
            if (this.options.pipeStderrToFile) {
                const targetStream = fs.createWriteStream(this.options.pipeStderrToFile, { flags: 'w' });
                this.childProcess.stderr.pipe(targetStream);
            }
        }


        if (this.encoding) {
            this.stdoutTextChunks = [];
            this.stderrTextChunks = [];
        }
    }

    _flushLines() {
        if (this.stdoutTextChunks?.length) {

            const lines = [...this.stdoutTextChunks].join('').split(/\r?\n/g);

            lines.forEach((x) => {
                this.emit('line', x, 'stdout');
            });
        }

        if (this.stderrTextChunks?.length) {

            const lines = [...this.stderrTextChunks].join('').split(/\r?\n/g);

            lines.forEach((x) => {
                this.emit('line', x, 'stderr');
            });
        }
    }
}

export interface SubProcess extends SubProcessRoutine {
    on(event: 'line', cb: (line: string, source: 'stdout' | 'stderr') => void): this;
    on(event: 'text', cb: (text: string, source: 'stdout' | 'stderr') => void): this;
    on(event: 'chunk', cb: (chunk: Buffer, source: 'stdout' | 'stderr') => void): this;
    on(event: 'data', cb: (data: Buffer | string, source: 'stdout' | 'stderr') => void): this;
    on(event: 'end', cb: () => void): this;

    on(event: 'start', cb: (info: {
        cmd: string,
        args: string[],
        spawnOptions?: AppSpawnOptions,
        pid: number,
        process: ChildProcess,
    }) => void): this;
    on(event: 'done', cb: (info: {
        cmd: string,
        args: string[],
        spawnOptions?: AppSpawnOptions,
        pid: number,
        code: number,
        signal: string,
        process: ChildProcess,
    }) => void): this;
    on(event: 'error', cb: (info: {
        cmd: string,
        args: string[],
        spawnOptions?: AppSpawnOptions,
        pid?: number,
        code?: number,
        signal?: string,
        process?: ChildProcess,
        err?: Error;
    }) => void): this;

    on(event: string | symbol, listener: (...args: any[]) => void): this;
}
