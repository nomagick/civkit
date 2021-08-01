/// <reference types="node" />
export declare const CUSTOM_MIME: {
    [key: string]: string[];
};
export declare function mimeTypeCompatible(thisMimeType: string, thatMimeType: string, sharedExt?: string): boolean;
export declare function mimeOfExt(ext: string): string | null;
export declare function extOfMime(mimeType: string): string | null;
export declare function detectFile(path: string): Promise<import("file-type/core").FileTypeResult | undefined>;
export declare function detectBuff(buff: Buffer): Promise<import("file-type/core").FileTypeResult | undefined>;
export declare function mimeOf(data: string | Buffer): Promise<MIMEVec>;
export interface MIMEVec {
    mediaType: string;
    subType: string;
    suffix?: string;
    attrs?: {
        [k: string]: string;
    };
}
export declare function restoreContentType(mimeVec: MIMEVec): string;
export declare function parseContentType(mimeStr: string): MIMEVec | null;
//# sourceMappingURL=mime.d.ts.map