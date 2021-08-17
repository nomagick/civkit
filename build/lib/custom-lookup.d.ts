/// <reference types="node" />
import { LookupOptions } from 'dns';
export declare function makeCustomDNSResolveFunc(options: {
    hosts?: {
        [k: string]: string | string[];
    };
    servers?: string[];
    timeout?: number;
}): (hostname: string, options: LookupOptions, callback: (err: NodeJS.ErrnoException | null, address?: string | {
    address: string;
    family: number;
}[] | undefined, family?: number | undefined) => void) => Promise<void>;
//# sourceMappingURL=custom-lookup.d.ts.map