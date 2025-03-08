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
