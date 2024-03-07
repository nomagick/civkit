/* eslint-disable @typescript-eslint/no-magic-numbers */
import 'reflect-metadata';
import { ParamValidationError, ApplicationError } from './errors';
import { AsyncService } from '../lib/async-service';
import {
    assignMeta, extractMeta, extractTransferProtocolMeta,
    RPC_MARSHAL,
    RPC_TRANSFER_PROTOCOL_META_SYMBOL,
    TransferProtocolMetadata,
    TPM
} from './meta';
import {
    Also, AutoCastable, AutoCastableMetaClass,
    AutoCastingError, Prop, PropOptions
} from '../lib/auto-castable';
import { Combine } from '../lib/auto-castable-utils';
import { isPrimitiveLike, marshalErrorLike } from '../utils';
import { Readable, isReadable } from 'stream';
import { RPCOptions } from './registry';
import _, { get } from 'lodash';

export const RPC_CALL_ENVIRONMENT = Symbol('RPCEnv');
export const RPC_REFLECT = Symbol('RPCReflect');

export class RPCHost extends AsyncService {
    setResultMeta<T extends object, P extends object>(target: T, metaToSet: P) {
        assignMeta(target, metaToSet);

        return target;
    }

    getResultMeta(target: object) {
        return extractMeta(target);
    }
}

export class Dto<T = any> extends AutoCastable {
    protected [RPC_CALL_ENVIRONMENT]?: T;
    protected [RPC_MARSHAL]?: (...args: any[]) => any;

    static override from(input: object): any {
        try {
            const r = super.from(input) as Dto<unknown>;

            if (input.hasOwnProperty(RPC_CALL_ENVIRONMENT)) {
                r[RPC_CALL_ENVIRONMENT] = (input as any)[RPC_CALL_ENVIRONMENT];
            }

            return r;
        } catch (err) {
            if (err instanceof ApplicationError) {
                throw err;
            }
            if (err instanceof AutoCastingError) {
                throw new ParamValidationError({
                    ...err,
                    readableMessage: get(err.cause, 'message') || err.reason,
                });
            }

            throw err;
        }
    }
}

export const RPCParam = Dto;

export async function rpcExport(sth: any, stackDepth = 0): Promise<any> {
    if (stackDepth >= 10) {
        throw new Error('Maximum rpc export stack depth reached');
    }
    if (typeof sth?.[RPC_MARSHAL] === 'function') {
        return rpcExport(await sth[RPC_MARSHAL](), stackDepth + 1);
    }

    return sth;
}

export async function rpcExportDeep(sth: any, stackDepth = 0): Promise<any> {
    if (stackDepth >= 10) {
        throw new Error('Maximum rpc export stack depth reached');
    }

    if (typeof sth?.[RPC_MARSHAL] === 'function') {
        return rpcExport(await sth[RPC_MARSHAL](), stackDepth + 1);
    }

    if (isPrimitiveLike(sth)) {
        return sth;
    }

    if (isReadable(sth)) {
        return sth;
    }

    if (Array.isArray(sth)) {
        if (Object.getPrototypeOf(sth) !== Array.prototype) {
            // Attempted array
            const r: any = Object.create(sth);
            const chunks = await Promise.all(sth.map(async ([v, idx]) => [idx, await rpcExport(v)]));
            for (const [k, v] of chunks) {
                r[k] = v;
            }

            return r;
        }

        return Promise.all(sth.map((x) => rpcExport(x, stackDepth)));
    }

    if (sth && typeof sth === 'object') {
        const r: any = Object.create(sth);
        const chunks = await Promise.all(Object.entries(sth).map(async ([k, v]) => [k, await rpcExport(v)]));
        for (const [k, v] of chunks) {
            r[k] = v;
        }

        return r;
    }

    return sth;
}

export class RPCEnvelope {
    async wrap(data: any, _meta?: object) {
        const result = await rpcExport(data);

        return {
            tpm: {
                code: 200,
                ...(extractTransferProtocolMeta(result) || extractTransferProtocolMeta(data))
            },
            output: result,
        } as { tpm?: TransferProtocolMetadata; output: any; };
    }

    async wrapError(err: any) {
        const result = await rpcExport(err);

        return {
            tpm: {
                code: 500,
                ...(extractTransferProtocolMeta(result) || extractTransferProtocolMeta(err))
            },
            output: result,
        } as { tpm?: TransferProtocolMetadata; output: any; };
    }

    describeWrap(rpcOptions: RPCOptions): Partial<RPCOptions> {
        return rpcOptions;
    }
}

export class IntegrityEnvelope extends RPCEnvelope {
    override async wrap(data: any, meta?: object) {
        let code = 200;
        let status = 20000;
        let wrapOutput = true;
        const draft = await rpcExport(data);
        const tpm = extractTransferProtocolMeta(draft) || extractTransferProtocolMeta(data);

        if (tpm) {
            code = tpm.code || code;
            status = tpm.status || code;
        }

        if (
            draft instanceof Readable ||
            (typeof draft?.pipe === 'function') ||
            Buffer.isBuffer(draft) ||
            draft instanceof Blob
        ) {
            wrapOutput = false;
        }

        return {
            tpm: {
                code: 200,
                status: 20000,
                contentType: wrapOutput ? 'application/json' : undefined,
                ...tpm
            },
            output: wrapOutput ? {
                code,
                status,
                data: draft,
                meta
            } : draft
        };
    }

    override describeWrap(rpcOptions: RPCOptions) {
        const envelopeClassName = this.constructor.name;
        const wrappedPropOptions: PropOptions<any> = {};
        if (rpcOptions.returnArrayOf) {
            wrappedPropOptions.arrayOf = rpcOptions.returnArrayOf;
        } else if (rpcOptions.returnDictOf) {
            wrappedPropOptions.dictOf = rpcOptions.returnDictOf;
        }

        if (
            wrappedPropOptions.arrayOf ||
            wrappedPropOptions.dictOf
        ) {
            @TPM({
                code: 200,
                status: 20000,
                contentType: 'application/json'
            })
            @Also({
                openapi: {
                    primitive: true
                }
            })
            class WrappedOutput extends AutoCastableMetaClass {
                @Prop({
                    type: Number, default: 200, required: true,
                    desc: 'Envelope code.\n\nMirror of HTTP status code',
                    partOf: envelopeClassName,
                })
                code!: number;

                @Prop({
                    type: Number, default: 20000, required: true,
                    desc: 'Envelope status.\n\nIn extension to HTTP status code',
                    partOf: envelopeClassName,
                })
                status!: number;

                @Prop({
                    ..._.pick(wrappedPropOptions, ['arrayOf', 'dictOf']),
                    desc: 'The result payload you expect',
                    partOf: envelopeClassName,
                })
                data!: any;

                @Prop({
                    type:
                        Array.isArray(rpcOptions.returnMetaType) ?
                            Combine(...rpcOptions.returnMetaType) :
                            rpcOptions.returnMetaType,
                    desc: 'The metadata that the payload sometimes came with',
                    partOf: envelopeClassName,
                })
                meta?: any;
            }

            const types = wrappedPropOptions.arrayOf || wrappedPropOptions.dictOf;

            const typeNames = Array.isArray(types) ? types.map((x) => x.name).filter(Boolean).join('And') : types.name;
            const metaNames = Array.isArray(rpcOptions.returnMetaType) ?
                rpcOptions.returnMetaType.map((x) => x.name).filter(Boolean).join('And') :
                rpcOptions.returnMetaType?.name;

            Object.defineProperty(WrappedOutput, 'name', {
                value: `${this.constructor.name}Wrapped${typeNames}${metaNames ? `WithMeta${metaNames}` : ''}`,
            });

            return {
                ..._.omit(rpcOptions, ['returnType', 'returnArrayOf', 'returnDictOf']),
                returnType: WrappedOutput as any
            };
        }
        const types = Array.isArray(rpcOptions.returnType) ? rpcOptions.returnType : [rpcOptions.returnType];
        const finalTypes = types.map((x) => {
            if (
                x === Readable ||
                (x?.prototype instanceof Readable) ||
                (typeof x?.prototype?.pipe) === 'function'
            ) {
                return x;
            } else if (
                x === Buffer ||
                x?.prototype instanceof Buffer
            ) {
                return x;
            }

            @Also({
                openapi: {
                    primitive: true
                }
            })
            class WrappedOutput extends AutoCastableMetaClass {

                protected get [RPC_TRANSFER_PROTOCOL_META_SYMBOL]() {
                    return {
                        code: 200,
                        status: 20000,
                        contentType: 'application/json',
                        ...x?.prototype?.[RPC_TRANSFER_PROTOCOL_META_SYMBOL],
                    };
                }

                @Prop({
                    type: Number, default: 200, required: true,
                    partOf: envelopeClassName,
                    desc: 'Envelope code.\n\nMirror of HTTP status code',
                })
                code!: number;

                @Prop({
                    type: Number, default: 20000, required: true,
                    partOf: envelopeClassName,
                    desc: 'Envelope status.\n\nIn extension to HTTP status code',
                })
                status!: number;

                @Prop({
                    type: x,
                    partOf: envelopeClassName,
                    desc: `The result payload you expect`,
                })
                data!: typeof x;

                @Prop({
                    type:
                        Array.isArray(rpcOptions.returnMetaType) ?
                            Combine(...rpcOptions.returnMetaType) :
                            rpcOptions.returnMetaType,
                    partOf: envelopeClassName,
                    desc: 'The metadata that the payload sometimes came with',
                })
                meta?: any;
            }

            const metaNames = Array.isArray(rpcOptions.returnMetaType) ?
                rpcOptions.returnMetaType.map((x) => x.name).filter(Boolean).join('And') :
                rpcOptions.returnMetaType?.name;

            Object.defineProperty(WrappedOutput, 'name', {
                value: `${this.constructor.name}Wrapped${x?.name}${metaNames ? `WithMeta${metaNames}` : ''}`,
            });

            return WrappedOutput;
        });

        return {
            ..._.omit(rpcOptions, ['returnType', 'returnArrayOf', 'returnDictOf']),
            returnType: finalTypes as any[],
        };
    }


    override async wrapError(err: any) {
        let draft = await rpcExport(err);

        if (err === draft) {
            draft = marshalErrorLike(err);
        }

        if (!(draft.code && draft.status && draft.message)) {
            draft = {
                code: 500,
                status: 50000,
                message: 'Unknown error',
                ...draft,
            };
        }

        const tpm = extractTransferProtocolMeta(err);

        return {
            tpm: {
                code: 500,
                status: 50000,
                contentType: 'application/json',
                ...tpm,
            },
            output: draft
        };
    }
}
