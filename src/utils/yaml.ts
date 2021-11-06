import { promises as fsp } from 'fs';
import yaml from 'js-yaml';


export async function loadYamlFile<T = any>(path: string) {
    const fContent = await fsp.readFile(path, { encoding: 'utf-8' });

    return yaml.load(fContent) as any as T;
}

export function loadYamlText(text: string) {

    return yaml.load(text);
}

export function loadYamlBase64Text(text: string) {

    return yaml.load(Buffer.from(text, 'base64').toString('utf-8'));
}
