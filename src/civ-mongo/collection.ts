import {
    ObjectId, AggregateOptions, BulkWriteOptions,
    ChangeStream, ChangeStreamDocument, ChangeStreamOptions,
    ClientSession, ClientSessionOptions, Collection,
    CountDocumentsOptions, DeleteOptions, Document, Filter,
    FindOneAndDeleteOptions, FindOneAndReplaceOptions, FindOneAndUpdateOptions,
    FindOptions, InsertOneOptions, MatchKeysAndValues,
    OptionalId, UpdateFilter, UpdateOptions, WithTransactionCallback, WithoutId, 
    CollectionInfo, CreateIndexesOptions, IndexSpecification, CreateCollectionOptions
} from 'mongodb';

import { AsyncService } from '../lib/async-service';
import { AbstractMongoDB } from './client';
import _ from 'lodash';
import { LoggerInterface } from '../lib';
import { PassThrough, Readable } from 'stream';
import { deepCreate, vectorize2 } from './misc';
import { delay } from '../utils/timeout';

export abstract class AbstractMongoCollection<T extends Document, P = ObjectId> extends AsyncService {

    abstract collectionName: string;
    abstract mongo: AbstractMongoDB;
    protected abstract logger: LoggerInterface;

    typeclass?: { new(): T; };

    indexes?: Array<
        readonly [string, IndexSpecification] |
        readonly [string, IndexSpecification, Omit<CreateIndexesOptions, 'name' | 'session'>]
    >;

    collection!: Collection<T>;

    constructor(...whatever: any[]) {
        super(...whatever);


        // mongo should come from prototype, thus accessible from constructor.
        this.dependsOn((this as any).mongo);
    }

    override async init() {
        await this.dependencyReady();
        // Cripple only once because init function could be called multiple times.
        // One cripple per ready.
        this.mongo.once('crippled', () => this.emit('crippled'));
        this.collection = this.mongo.db.collection<T>(this.collectionName);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async createIndexes(allIndexesOptions?: Partial<CreateIndexesOptions>) {
        if (!this.indexes?.length) {
            this.logger.warn(`No indexes defined for ${this.constructor.name}(${this.collectionName})`);
            return;
        }

        let i = 0;
        for (const [name, spec, options] of this.indexes) {
            if (await this.collection.indexExists(name)) {
                this.logger.info(`Index ${name} for ${this.constructor.name}(${this.collectionName}) already exists`);
                continue;
            }

            this.logger.info(`Creating index ${name} for ${this.constructor.name}(${this.collectionName})...`);
            await this.collection.createIndex(spec, { ...allIndexesOptions, ...options, name });
            this.logger.info(`Index created: ${name} for ${this.constructor.name}(${this.collectionName})`);
            i++;
        }

        this.logger.info(`Created ${i} indexes for ${this.constructor.name}(${this.collectionName})`);
    }

    async ensureCollection(options?: Partial<CreateCollectionOptions>) {
        this.logger.info(`Ensuring collection ${this.constructor.name}(${this.collectionName})...`);
        const r = await this.mongo.db.listCollections(
            { name: this.collectionName },
            { nameOnly: true, session: options?.session }
        ).toArray();

        if (r.length) {
            this.logger.info(`Looks like collection ${this.constructor.name}(${this.collectionName}) already exists`);
            return;
        }

        if (r.length <= 0) {
            this.logger.warn(`Creating collection ${this.constructor.name}(${this.collectionName})...`);
            await this.mongo.db.createCollection(this.collectionName, options);

            this.logger.info(`Collection created: ${this.constructor.name}(${this.collectionName})`);
        }
    }

    async getForModification(_id: P) {
        const r = await this.get(_id);

        if (!r) {
            return r;
        }

        return deepCreate(r);
    }

    async get(_id: P) {
        const r = await this.collection.findOne({ _id } as Filter<T>);

        return r || undefined;
    }

    async count(query: Filter<T>, options?: CountDocumentsOptions) {
        const r = await this.collection.countDocuments(query, options!);

        return r;
    }

    async findOne(query: Filter<T>, options?: FindOptions<T>) {
        const r = await this.collection.findOne(query, options);

        return r || undefined;
    }

    async findOneAndDelete(
        query: Filter<T>,
        options?: FindOneAndDeleteOptions & { bypassDocumentValidation?: boolean | undefined; }
    ): Promise<T | undefined> {
        const r = await this.collection.findOneAndDelete(query, { ...options, includeResultMetadata: true });

        return (r.value as T) || undefined;
    }

    async simpleFind(query: Filter<T>, options?: FindOptions<T>) {
        const r = await this.collection.find(query, options as FindOptions<T>).toArray();

        return r as T[];
    }

    async simpleAggregate<M = any>(pipeline?: object[], options?: AggregateOptions) {
        const r = await this.collection.aggregate(pipeline, options).toArray();

        return r as any as M[];
    }

    async updateOne(
        filter: Filter<T>,
        update: UpdateFilter<T> | T,
        options?: FindOneAndUpdateOptions,
    ) {
        const r = await this.collection.findOneAndUpdate(filter, update, { returnDocument: 'after', ...options, includeResultMetadata: true });

        if (!r.ok) {
            throw r.lastErrorObject;
        }

        return (r.value as T | null) || undefined;
    }

    async updateMany(
        filter: Filter<T>,
        update: UpdateFilter<T> | Partial<T>,
        options?: UpdateOptions,
    ) {
        const r = await this.collection.updateMany(filter, update, options!);

        return r;
    }

    async upsertOne(
        filter: Filter<T>,
        update: UpdateFilter<T> | T,
        options?: FindOneAndUpdateOptions,
    ) {
        const r = await this.collection.findOneAndUpdate(
            filter,
            update,
            { upsert: true, returnDocument: 'after', ...options, includeResultMetadata: true });

        if (!r.ok) {
            throw r.lastErrorObject;
        }

        return (r.value as T) || undefined;
    }

    async replaceOne(
        filter: Filter<T>,
        replace: OptionalId<T>,
        options?: FindOneAndReplaceOptions,
    ) {
        const r = await this.collection.findOneAndReplace(
            filter,
            _.omit(replace, '_id') as WithoutId<T>,
            { upsert: true, returnDocument: 'after', ...options, includeResultMetadata: true });

        if (!r.ok) {
            throw r.lastErrorObject;
        }

        return (r.value as T) || undefined;
    }

    async insertOne(
        doc: OptionalId<T>,
        options?: InsertOneOptions,
    ) {
        const r = await this.collection.insertOne(
            doc as any,
            options!
        );

        if (r.insertedId) {
            doc._id = r.insertedId;
        }

        return doc as T;
    }

    async insertMany(
        docs: Array<OptionalId<T>>,
        options?: BulkWriteOptions,
    ) {
        const r = await this.collection.insertMany(
            docs as any,
            options!
        );

        if (r.insertedIds) {
            for (const [i, id] of Object.entries(r.insertedIds)) {
                docs[Number(i)]._id = id;
            }
        }

        return docs as T[];
    }

    async create(data: Partial<T>, options?: InsertOneOptions) {
        const now = new Date();
        const doc: any = { ...data, createdAt: now, updatedAt: now };

        return this.insertOne(doc, options);
    }

    async set(_id: P, data: Partial<T>, options?: FindOneAndUpdateOptions) {
        const now = new Date();
        const r = await this.collection.findOneAndUpdate(
            { _id } as Filter<T>,
            { $set: vectorize2({ ...data, updatedAt: now }), $setOnInsert: { createdAt: now } } as any,
            { upsert: true, returnDocument: 'after', ...options, includeResultMetadata: true }
        );
        if (!r.ok) {
            throw r.lastErrorObject;
        }
        return r.value! as T;
    }

    async simpleSet(_id: P, data: Partial<T>, options?: FindOneAndUpdateOptions) {
        const now = new Date();
        const r = await this.collection.findOneAndUpdate(
            { _id } as Filter<T>,
            { $set: { ..._.omit(data, '_id'), updatedAt: now }, $setOnInsert: { createdAt: now } } as any,
            { upsert: true, returnDocument: 'after', ...options, includeResultMetadata: true }
        );
        if (!r.ok) {
            throw r.lastErrorObject;
        }
        return r.value! as T;
    }

    async withTransaction<T>(func: WithTransactionCallback<T>, options?: ClientSessionOptions & {
        maxTries?: number;
        retryDelayMs?: number;
    }): Promise<T> {
        const session = this.mongo.createSession(options);
        const maxTries = options?.maxTries ?? 30;
        let triesLeft = maxTries;
        let lastError: Error | undefined;
        let firstTry = true;
        let finalReturn: any;
        let finalThrow: any;

        const patchedFunc = async function (this: unknown, ...args: Parameters<typeof func>) {
            if (triesLeft <= 0) {
                if (lastError) {
                    lastError.message = `${lastError.message} (after ${maxTries} tries)`;
                    finalThrow = lastError;

                    return;
                }
                finalThrow = new Error(`Transaction failed after ${maxTries} tries`);

                return;
            }
            if (firstTry) {
                firstTry = false;
            } else if (options?.retryDelayMs) {
                await delay(options.retryDelayMs);
            }

            triesLeft -= 1;

            try {
                finalReturn = await func.apply(this, args);
                return finalReturn;
            } catch (err: any) {
                lastError = err;
                throw err;
            }
        };

        try {
            // Mongo's withTransaction is stupid and going to retry indefinitely if it doesn't recognize the error? wtf?
            await session.withTransaction(patchedFunc, options?.defaultTransactionOptions);

            if (finalThrow) {
                throw finalThrow;
            }

            return finalReturn;
        } catch (err) {
            try {
                await session.abortTransaction();
            } catch (_err2) {
                // Nothing could be done if aborting the transaction failed
                // Let the session end and transaction to expire
                // Swallow the transaction abortion error here.
                void 0;
            }

            throw err;
        } finally {
            if (!session.hasEnded) {
                try {
                    await session.endSession({ force: true, forceClear: true });
                } catch (_err3) {
                    // Nothing could be done if endSession fails.
                    // Also, it's not a big deal if the session is already ended.
                    // So swallow the error here.
                    void 0;
                }
            }
        }

    }

    async save(data: Partial<T> & { _id: P; }, options?: FindOneAndUpdateOptions) {
        const r = await this.collection.findOneAndUpdate(
            { _id: data._id } as Filter<T>,
            { $set: _.omit(data, '_id') } as any as MatchKeysAndValues<T>,
            {
                upsert: true,
                returnDocument: 'after',
                ...options,
                includeResultMetadata: true
            });

        if (!r.ok) {
            throw r.lastErrorObject;
        }

        return r.value! as T;
    }

    clear(_id: P) {
        return this.collection.deleteOne({ _id } as Filter<T>);
    }

    del(_id: P) {
        return this.collection.deleteOne({ _id } as Filter<T>);
    }

    async deleteOne(
        filter: Filter<T>,
        options?: DeleteOptions & { bypassDocumentValidation?: boolean | undefined; }
    ) {

        const r = await this.collection.deleteOne(filter, options!);

        return r;
    }

    async deleteMany(
        filter: Filter<T>,
        options?: DeleteOptions
    ) {
        const r = await this.collection.deleteMany(filter, options!);

        return r;
    }

    subscribe(
        options?: |
            ChangeStreamOptions &
            {
                query?: Filter<ChangeStreamDocument<T>>;
                session?: ClientSession | undefined;
            }): ChangeStream<T>;
    subscribe(
        operations: ChangeStreamDocument['operationType'] | ChangeStreamDocument['operationType'][],
        options?: |
            ChangeStreamOptions &
            {
                query?: Filter<ChangeStreamDocument<T>>;
                session?: ClientSession | undefined;
            }): ChangeStream<T>;
    subscribe(...args: any[]) {
        let [operations, options] = args;
        if (typeof operations === 'string') {
            operations = [operations];
        } else if (!Array.isArray(operations) && typeof operations === 'object') {
            options = operations;
            operations = undefined;
        } else {
            options = operations || undefined;
            operations = undefined;
        }

        const matchQuery: any = {
            ...(options?.query)
        };

        if (operations?.length) {
            matchQuery.operationType = { $in: operations };
        }

        const changeStream = this.collection.watch(
            [{ $match: matchQuery }], { fullDocument: 'updateLookup', ...options }
        );

        this.once('crippled', () => changeStream.closed ?? changeStream.close()?.catch(() => 'swallow'));

        return changeStream;
    }
}


export abstract class AbstractMongoCappedCollection<T extends object, P = ObjectId> extends AbstractMongoCollection<T, P> {
    abstract collectionSize: number;

    override async ensureCollection(options?: { session?: ClientSession; }) {
        this.logger.info(`Ensuring capped collection ${this.constructor.name}(${this.collectionName})...`);
        const r = await this.mongo.db.listCollections(
            { name: this.collectionName },
            { session: options?.session }
        ).toArray();

        if (r.length) {
            const collection: CollectionInfo | undefined = r[0];
            if (!(collection?.options?.capped)) {
                throw new Error(`Collection ${this.collectionName} is supposed to be a capped collection however a normal collection with the same name already existed.`);
            }
            if (collection?.options?.size !== this.collectionSize) {
                throw new Error(`Capped collection ${this.collectionName} is supposed to have size ${this.collectionSize} however it has size ${collection.options.size}.`);
            }

            this.logger.info(`Looks like capped collection ${this.constructor.name}(${this.collectionName}) already exists`);
            return;
        }

        if (r.length <= 0) {
            this.logger.warn(`Creating capped collection ${this.constructor.name}(${this.collectionName}) with size ${this.collectionSize}...`);
            await this.mongo.db.createCollection(this.collectionName, { capped: true, size: this.collectionSize });

            this.logger.info(`Capped collection created: ${this.constructor.name}(${this.collectionName})`);
        }
    }

    async simpleTail(query: Filter<T>, options?: FindOptions<T>) {
        const throughStream = new PassThrough({
            writableObjectMode: true, readableObjectMode: true, decodeStrings: false
        });
        let cursorStream: Readable | undefined;
        let lastId: P | undefined;
        let stop: boolean = false;
        const rotate = async () => {
            if (stop) {
                return;
            }
            const lastCursorStream = cursorStream;
            const patchedQuery: any = { ...query };
            if (lastId && !patchedQuery._id) {
                patchedQuery._id = { $gt: lastId };
            }

            cursorStream = this.collection.find(patchedQuery, {
                sort: { $natural: 1 },
                ...options,
                tailable: true,
                awaitData: true,
                noCursorTimeout: true,
            } as FindOptions<T>).stream();
            cursorStream.on('data', (data: T & { _id: P; }) => {
                lastId = data._id;
            });
            cursorStream.once('close', rotate);
            if (lastCursorStream) {
                lastCursorStream.unpipe(throughStream);
            }
            cursorStream.pipe(throughStream, { end: false });
        };
        throughStream.once('close', () => {
            stop = true;
            if (cursorStream) {
                cursorStream.destroy();
            }
        });
        rotate();

        return throughStream as Readable;
    }
}
