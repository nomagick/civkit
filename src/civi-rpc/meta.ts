import _, { cloneDeep } from 'lodash';
import { isConstructor } from '../utils';
import { objHashMd5B64Of } from '../lib/hash';
import type { RPCEnvelope } from './base';

export const RPC_RESULT_META_SYMBOL = Symbol('RPC result metas');
export const RPC_MARSHALL = Symbol('RPCMarshall');

export function assignMeta<T extends object, P extends object>(target: T, meta: P): T {
    const curMeta = (target as any)[RPC_RESULT_META_SYMBOL];
    if (!curMeta) {
        (target as any)[RPC_RESULT_META_SYMBOL] = meta;

        return target;
    }

    _.merge(curMeta, meta);

    return target;
}

export function extractMeta(target: object): { [k: string]: any; } | undefined {
    if (typeof target !== 'object' || !target) {
        return;
    }
    return (target as any)[RPC_RESULT_META_SYMBOL];
}

export const RPC_TRANSFER_PROTOCOL_META_SYMBOL = Symbol('RPC transfer protocol metas');

export interface TransferProtocolMetadata {
    code?: number;
    status?: number;
    contentType?: string;
    headers?: { [k: string]: string; };
    envelope?: typeof RPCEnvelope | null;

    [k: string]: any;
}

function patchTransferProtocolMeta(meta: TransferProtocolMetadata) {
    if (Number.isInteger(meta.code) && meta.status === undefined) {
        if (meta.code! >= 100 && meta.code! < 1000) {
            meta.status = meta.code! * 100;
        }
    } else if (Number.isInteger(meta.status) && meta.code === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-magic-numbers
        if (meta.status! >= 10000 && meta.status! < 100000) {
            meta.code = Math.floor(meta.status! / 100);
        }
    }
}

export function assignTransferProtocolMeta<T extends any, P extends TransferProtocolMetadata>(
    inputTarget: T, meta?: P
): T extends object ? T : P extends object ? object : T {
    if (!meta) {
        return inputTarget as any;
    }

    const target: any = (typeof inputTarget === 'object' || typeof inputTarget === 'function') ? inputTarget : {
        [RPC_MARSHALL]() {
            return inputTarget as any;
        }
    };

    const curMeta = (target as any)[RPC_TRANSFER_PROTOCOL_META_SYMBOL];
    if (!curMeta) {
        patchTransferProtocolMeta(meta);
        (target as any)[RPC_TRANSFER_PROTOCOL_META_SYMBOL] = meta;

        return target;
    }

    if (!target.hasOwnProperty(RPC_TRANSFER_PROTOCOL_META_SYMBOL)) {
        (target as any)[RPC_TRANSFER_PROTOCOL_META_SYMBOL] = cloneDeep(curMeta);
    }

    patchTransferProtocolMeta(meta);
    _.merge(curMeta, meta);

    return target;
}

export function extractTransferProtocolMeta(target?: object): TransferProtocolMetadata | undefined {
    if ((typeof target !== 'object' && typeof target !== 'function') || !target) {
        return;
    }
    return (target as any)[RPC_TRANSFER_PROTOCOL_META_SYMBOL];
}

export function transferProtocolMetaDecorated<T extends TransferProtocolMetadata>(
    meta: T, tgt: object | { new(..._args: any[]): any; }
) {

    if (isConstructor(tgt as any)) {
        return assignTransferProtocolMeta((tgt as { new(..._args: any[]): any; }).prototype, meta);
    }

    return assignTransferProtocolMeta(tgt, meta);
}

export function MixTPM<T extends { new(...args: any[]): any; }>(
    meta: TransferProtocolMetadata, tgt: T
) {
    @TPM(meta)
    class TPMDecorated extends tgt { }

    Object.defineProperty(TPMDecorated, 'name', {
        value: `${tgt.name}WithTPM:${objHashMd5B64Of(meta).replaceAll('=', '')}`,
        writable: false,
    });

    return TPMDecorated as T;
}

export function TPM(meta: TransferProtocolMetadata) {
    return function transferProtocolMetaDecorator<T extends { new(..._args: any[]): any; }>(target: T) {
        transferProtocolMetaDecorated(meta, target);
    };
}

export const withTransferProtocolMeta = assignTransferProtocolMeta;
