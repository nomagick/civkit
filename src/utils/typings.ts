/* eslint-disable @typescript-eslint/no-magic-numbers */

export type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
    k: infer I
) => void
    ? I
    : never;

export type ExtractParameters<T> = 'parameters' extends keyof T
    ? UnionToIntersection<
        {
            [K in keyof T['parameters']]: T['parameters'][K];
        }[keyof T['parameters']]
    >
    : {};

export type ExtractRequestBody<T> = 'requestBody' extends keyof T
    ? 'content' extends keyof T['requestBody']
    ? 'application/json' extends keyof T['requestBody']['content']
    ? T['requestBody']['content']['application/json']
    : {
        data: {
            [K in keyof T['requestBody']['content']]: T['requestBody']['content'][K];
        }[keyof T['requestBody']['content']];
    }
    : 'application/json' extends keyof T['requestBody']
    ? T['requestBody']['application/json']
    : {
        data: {
            [K in keyof T['requestBody']]: T['requestBody'][K];
        }[keyof T['requestBody']];
    }
    : {};

export type Extract200JSONResponse<T> = 'responses' extends keyof T
    ? 200 extends keyof T['responses']
    ? 'content' extends keyof T['responses'][200]
    ? 'application/json' extends keyof T['responses'][200]['content']
    ? T['responses'][200]['content']['application/json']
    : unknown
    : unknown
    : unknown
    : unknown;


export type OpenAPIJSONRequest<T, P extends keyof T, M extends keyof T[P]> = ExtractRequestBody<T[P][M]> &
    ExtractParameters<T[P][M]>;
export type OpenAPI200JSONResponse<T, P extends keyof T, M extends keyof T[P]> = Extract200JSONResponse<T[P][M]>;


export type JSONPatch =
    | { op: 'add' | 'replace' | 'test', path: string, value: any; }
    | { op: 'copy' | 'move', from: string, path: string; }
    | { op: 'replace', path: string, value: any; }
    | { op: 'remove', path: string; };
