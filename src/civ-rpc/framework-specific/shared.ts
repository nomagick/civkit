import { FancyFile } from "../../lib/fancy-file";
import { MIMEVec } from "../../lib/mime";

export type UploadedFile = FancyFile & {
    field?: string;
    claimedName?: string;
    claimedContentType?: MIMEVec | null;
    claimedMime?: string;
};
