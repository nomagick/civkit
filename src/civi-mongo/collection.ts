import _ from 'lodash';
import {
    AggregateOptions, ChangeStream, ChangeStreamDocument, ChangeStreamOptions,
    ClientSession, Collection, CountDocumentsOptions, DeleteOptions, Filter,
    FindOneAndUpdateOptions, FindOptions, InsertOneOptions, ObjectId, OptionalId, UpdateFilter,
    UpdateOptions
} from 'mongodb';
import { deepCreate, vectorize } from '../utils';
import { AsyncService } from '../lib/async-service';
import { AbstractMongoDB } from './client';

export abstract class AbstractMongoCollection<T extends object, P = ObjectId> extends AsyncService {

    abstract collectionName: string;
    abstract mongo: AbstractMongoDB;

    abstract typeclass?: { new(): T; };

    collection!: Collection<T>;

    constructor(...whatever: any[]) {
        super(...whatever);

        // mongo should come from prototype, thus accessible from constructor.
        this.dependsOn((this as any).mongo);
    }

    override async init() {
        this.mongo.on('crippled', () => this.emit('crippled'));
        await this.dependencyReady();
        this.collection = this.mongo.db.collection(this.collectionName);
    }

    async createIndexes(_options?: object) {
        return;
    }

    async ensureCollection(_options?: object) {
        const r = await this.mongo.db.listCollections(
            { name: this.collectionName },
            { nameOnly: true }
        ).toArray();

        if (r.length) {
            return;
        }

        if (r.length <= 0) {
            await this.mongo.db.createCollection(this.collectionName);
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
        const r = await this.collection.findOne({ _id });

        return r;
    }

    async count(query: Filter<T>, options?: CountDocumentsOptions) {
        const r = await this.collection.countDocuments(query, options!);

        return r;
    }

    async findOne(query: Filter<T>, options?: FindOptions<T>) {
        const r = await this.collection.findOne(query, options);

        return r || undefined;
    }

    async simpleFind(query: Filter<T>, options?: FindOptions<T>) {
        const r = await this.collection.find(query, options as FindOptions<T>).toArray();

        return r;
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
        const r = await this.collection.findOneAndUpdate(filter, update, { returnDocument: 'after', ...options });

        if (!r.ok) {
            throw r.lastErrorObject;
        }

        return r.value || undefined;
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
            { upsert: true, returnDocument: 'after', ...options });

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

    async create(data: Partial<T>, options?: InsertOneOptions) {
        const now = new Date();
        const doc: any = { ...data, createdAt: now, updatedAt: now };

        return this.insertOne(doc, options);
    }

    async set(_id: P, data: Partial<T>, options?: FindOneAndUpdateOptions) {
        const now = new Date();
        const r = await this.collection.findOneAndUpdate(
            { _id },
            { $set: vectorize({ ...data, updatedAt: now }), $setOnInsert: { createdAt: now } } as any,
            { upsert: true, returnDocument: 'after', ...options }
        );
        if (!r.ok) {
            throw r.lastErrorObject;
        }
        return r.value! as T;
    }

    async save(data: Partial<T> & { _id: P; }, options?: FindOneAndUpdateOptions) {
        const r = await this.collection.findOneAndUpdate({ _id: data._id }, { $set: _.omit(data, '_id') as T }, {
            upsert: true,
            returnDocument: 'after',
            ...options,
        });

        if (!r.ok) {
            throw r.lastErrorObject;
        }

        return r.value! as T;
    }

    clear(_id: P) {
        return this.collection.deleteOne({ _id });
    }

    del(_id: P) {
        return this.collection.deleteOne({ _id });
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
