import { readFile } from 'fs';
import { promisify } from 'util';
import yaml from 'js-yaml';

const pReadfile = promisify(readFile);

export async function loadYamlFile(path: string) {

    const fContent = await pReadfile(path, { encoding: 'utf-8' });


    return yaml.safeLoad(fContent);
}

export function loadYamlText(text: string) {

    return yaml.safeLoad(text);
}

export function loadYamlBase64Text(text: string) {

    return yaml.safeLoad(Buffer.from(text, 'base64').toString('utf-8'));
}
