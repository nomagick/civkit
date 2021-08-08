import _ from "lodash";

export const RPC_RESULT_META_SYMBOL = Symbol('RPC result metas');

export function assignMeta(target: object, meta: object) {
    const curMeta = (target as any)[RPC_RESULT_META_SYMBOL];
    if (!curMeta) {
        (target as any)[RPC_RESULT_META_SYMBOL] = meta;

        return target;
    }

    _.merge(curMeta, meta);

    return target;
}

export function extractMeta(target: object): object | undefined {
    if (typeof target !== 'object' || !target) {
        return;
    }
    return (target as any)[RPC_RESULT_META_SYMBOL];
}
