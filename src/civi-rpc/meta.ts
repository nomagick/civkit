import _, { cloneDeep } from 'lodash';
import { isConstructor } from '../utils';

export const RPC_RESULT_META_SYMBOL = Symbol('RPC result metas');

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

export function assignTransferProtocolMeta<T extends object, P extends TransferProtocolMetadata>(
    target: T, meta: P
): T {
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

export function extractTransferProtocolMeta(target: object): TransferProtocolMetadata | undefined {
    if (typeof target !== 'object' || !target) {
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

export function TransferProtocolMetadata(meta: TransferProtocolMetadata) {
    return function transferProtocolMetaDecorator<T extends { new(..._args: any[]): any; }>(target: T) {
        transferProtocolMetaDecorated(meta, target);
    };
}

export const withTransferProtocolMeta = assignTransferProtocolMeta;
