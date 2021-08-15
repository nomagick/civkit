import { EventEmitter } from 'events';
import { Defer, TimeoutError } from './defer';

const nextTickFunc = process?.nextTick || setImmediate || setTimeout;
export abstract class AsyncService extends EventEmitter {

    protected __serviceReady: Promise<this>;

    protected __dependencies: AsyncService[];

    protected __status: 'ready' | 'revoked' | 'pending';

    constructor(...argv: AsyncService[]) {
        super();
        this.__status = 'pending';

        this.__dependencies = [];
        for (const x of argv) {
            if (x instanceof AsyncService) {
                this.__dependencies.push(x);
            }
        }

        const readyDeferred = Defer();

        this.__serviceReady = readyDeferred.promise;
        this.once('ready', () => {
            readyDeferred.resolve(this);
        });

        this.once('error', (err) => {
            readyDeferred.reject(err);
        });

        this.dependencyReady().catch((err) => this.emit('error', err));

        this.on('revoked', () => {
            this.__status = 'revoked';
        });

        this.on('ready', () => {
            this.__status = 'ready';
        });

        // this.dependencyReady.then(() => this.__init(), (err) => this.emit('error', err))
        //     .then(() => this.emit('ready', this), (err) => this.emit('error', err));
    }

    init(): any {
        // init is mainly for re-ready after revoked.
        // it's ok to omit or even replace if service never revoked.
        throw new Error('Not implemented');
    }

    serviceReady(): Promise<this> {
        if (this.__status === 'revoked') {
            this.__status = 'pending';

            this.__serviceReady = new Promise((_resolve, _reject) => {
                this.once('ready', () => _resolve(this));
                this.once('error', _reject);
                this.dependencyReady().catch((err) => this.emit('error', err));
            });

            nextTickFunc(() => {
                try {
                    const r = this.init();
                    if (r && (typeof r.catch === 'function')) {
                        r.catch((err: any) => {
                            this.emit('error', err);
                        });
                    }

                } catch (err) {
                    this.emit('error', err);
                }
            });
        }

        return this.__serviceReady;
    }

    dependencyReady(): Promise<AsyncService[]> {
        return new Promise((_resolve, _reject) => {

            setTimeout(() => {
                _reject(new TimeoutError('Timeout waiting for dependencies to be ready.'));
            }, 5000);

            _resolve(Promise.all(this.__dependencies.map((x) => x.serviceReady())).then((r) => {
                for (const x of r) {
                    if (x.__status !== 'ready') {
                        // Someone revoked, try activation again

                        return this.dependencyReady();
                    }
                }

                return r;
            }));
        });
    }

    // abstract async __init(): Promise<void>;

}
