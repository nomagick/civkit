

import { MongoClient, MongoClientOptions, Db, ClientSessionOptions } from 'mongodb';
import { AsyncService } from '../lib/async-service';
import { LoggerInterface } from '../lib/logger';

export abstract class AbstractMongoDB extends AsyncService {
    client!: MongoClient;
    db!: Db;
    abstract url: string;
    abstract options?: MongoClientOptions;
    abstract logger: LoggerInterface;
    constructor(...whatever: any[]) {
        super(...whatever);
        this.setMaxListeners(1000);

        // Very important to listen to error event.
        // This prevents the error from crashing the process.
        this.on('error', (err) => {
            this.resetClient();
            this.emit('crippled', err);
        });
    }

    createSession(options?: ClientSessionOptions) {
        const session = this.client.startSession(options as any);

        return session;
    }

    protected createClient() {
        return new MongoClient(this.url, this.options);
    }

    private async tryToConnect() {
        try {
            await this.client.connect();
        } catch (err: unknown) {
            this.logger.error('Mongo connection failed', { err });
            throw err;
        }
    }

    protected resetClient() {
        const theClient = this.createClient();
        theClient.on('error', async (err) => {
            this.emit('error', err);
            await theClient.close().catch((err) => {
                this.logger.error(
                    'Somehow Mongo close failed. Anyway the client is not being used anymore.', { err }
                );
            });
        });
        this.client = theClient;
        this.db = this.client.db();

        return theClient;
    }

    override async init() {
        await this.dependencyReady();

        // Please note 'ready' event should not be raised from this abstract class.
        // It's left to the concrete class to declare ready.
        if (this.client) {
            await this.tryToConnect();

            return;
        }

        this.client = this.resetClient();
        await this.tryToConnect();
    }
}
