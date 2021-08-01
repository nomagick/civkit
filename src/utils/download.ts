import { pipeline } from 'stream';
import { promisify } from 'util';
import fetch from 'node-fetch';
import fs from 'fs';

const streamPipeline = promisify(pipeline);

export async function downloadFile(uri: string, dest: string) {

    const resp = await fetch(uri);

    if (!resp.ok) {
        throw new Error(`Unexpected response ${resp.statusText}`);
    }

    const file = fs.createWriteStream(dest);

    await streamPipeline(resp.body, file);

    return dest;
}

