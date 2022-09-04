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

        this.on('error', (err) => {
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
        }
    }

    override async init() {
        await this.dependencyReady();

        if (this.client) {
            await this.tryToConnect();

            return;
        }

        const theClient = this.createClient();
        theClient.once('error', (err) => {
            this.emit('error', err);
            theClient.close(true);
        });

        this.client = theClient;
        await this.tryToConnect();

        this.db = this.client.db();

    }

    override async standDown() {
        if (this.serviceStatus !== 'ready') {
            return;
        }
        await this.client.close();
        super.standDown();
    }

}
