import { escape, zip } from 'lodash';

export function htmlEscape(strs: TemplateStringsArray, ...args: any[]) {
    return zip(strs, args).map(([str, arg]) => escape(`${str}${arg === undefined ? '' : arg}`)).join('');
}
