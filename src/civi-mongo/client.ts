import { MongoClient, MongoClientOptions, Db, ClientSessionOptions } from 'mongodb';
import { AsyncService } from '../lib/async-service';

export abstract class AbstractMongoDB extends AsyncService {
    client!: MongoClient;
    db!: Db;
    abstract url: string;
    abstract options?: MongoClientOptions;
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

    override async init() {
        await this.dependencyReady();

        const theClient = this.createClient();
        theClient.once('error', (err) => {
            this.emit('error', err);
            theClient.close(true);
        });

        this.client = theClient;
        await this.client.connect();

        this.db = this.client.db();

    }

}
