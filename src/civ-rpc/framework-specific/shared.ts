import { Readable } from "stream";
import { FancyFile } from "../../lib/fancy-file";
import { MIMEVec } from "../../lib/mime";

export type UploadedFile = FancyFile & {
    field?: string;
    claimedName?: string;
    claimedContentType?: MIMEVec | null;
    claimedMime?: string;
};

export function cleanParams(params?: Record<string, unknown>) {
    if (!params || typeof params !== 'object') {
        return;
    }
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined) {
            delete params[k];
        }
        if (v === '') {
            delete params[k];
        }
    }

    return params;
}

export function normalizeRPCOutput(output: any): any {
    if (ArrayBuffer.isView(output) && !Buffer.isBuffer(output)) {
        return Buffer.from(output.buffer, output.byteOffset, output.byteLength);
    }
    if (output instanceof ArrayBuffer) {
        return Buffer.from(output);
    }
    if (
        output !== null
        && typeof output === 'object'
        && !(output instanceof Readable || (typeof output?.pipe) === 'function')
        && typeof output[Symbol.asyncIterator] === 'function'
    ) {
        return Readable.from(output);
    }
    return output;
}
