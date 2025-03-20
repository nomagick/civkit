import { BSON } from 'mongodb';

import {
    vectorize2 as originalVectorize2,
    deepCreate as originalDeepCreate,
    deepSurface as originalDeepSurface,
} from '../utils/vectorize';

export const BSON_PROTOTYPES = new Set<object>();

for (const v of Object.values(BSON)) {
    if (typeof v === 'function' && v.prototype instanceof BSON.BSONValue) {
        BSON_PROTOTYPES.add(v.prototype);
    }
}

export function vectorize2(input: object) {
    return originalVectorize2(input, BSON_PROTOTYPES);
}

export function deepCreate(input: object) {
    return originalDeepCreate(input, BSON_PROTOTYPES);
}

export function deepSurface(input: object) {
    return originalDeepSurface(input, BSON_PROTOTYPES);
}
