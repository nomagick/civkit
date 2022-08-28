import { Also, AutoCastable } from '../lib/auto-castable';

@Also({
    desc: 'Magic dto that catches all input parameters which were not specifically read. Could be anything.',
    openapi: {
        schema: {
            type: 'object',
            additionalProperties: {
                description: 'Magic dto that catches all input parameters which were not specifically read. \n\n' +
                    'Could be anything.',
            },
        }
    }
})
export class RestParameters extends AutoCastable {
    [k: string]: any;
}

export function shallowDetectRestParametersKeys<T extends object>(input: T) {
    const keySet = new Set(Object.keys(input));
    const proxy = new Proxy(input, {
        get(target, prop) {
            keySet.delete(prop as any);

            return Reflect.get(target, prop);
        }
    });

    return {
        proxy,
        etcKeys: keySet
    };
}
