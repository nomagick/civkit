import { camelCase, camelCaseTransformMerge, snakeCase } from 'change-case';

export function objKeyToCamelCase(input: { [key: string]: any; }) {
    const output: { [key: string]: any; } = {};

    for (const key in input) {
        output[camelCase(key, { transform: camelCaseTransformMerge })] = input[key];
    }

    return output;
}

export function objKeyToSnakeCase(input: { [key: string]: any; }) {
    const output: { [key: string]: any; } = {};

    for (const key in input) {
        output[snakeCase(key)] = input[key];
    }

    return output;
}

export function toSnakeCase(input: string) {
    return snakeCase(input);
}

export function toCamelCase(input: string) {
    return camelCase(input, { transform: camelCaseTransformMerge });
}
