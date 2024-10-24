import fs, { promises as fsp } from 'fs';
import * as fswalk from '@nodelib/fs.walk';

export async function fileExists(path: string) {
    try {
        await fsp.access(path);
        return true;
    } catch (e) {
        return false;
    }
}

export async function existsSimpleFile(path: string) {
    try {
        const fstat = await fsp.lstat(path);

        return fstat.isFile() ? fstat : undefined;
    } catch (_e) {

        return undefined;
    }
}

export async function ensureDir(dirPath: string) {

    try {
        return (await fsp.stat(dirPath)).isDirectory();
    } catch {
        void 0;
    }

    return fsp.mkdir(dirPath, { recursive: true });
}

export async function ensureDirSync(dirPath: string) {

    try {
        return (fs.statSync(dirPath)).isDirectory();
    } catch {
        void 0;
    }

    return fs.mkdirSync(dirPath, { recursive: true });
}


export async function walkDirForSummary(dirPath: string) {
    const walkStream = fswalk.walkStream(dirPath, {
        followSymbolicLinks: false,
        stats: true,
        throwErrorOnBrokenSymbolicLink: false
    });

    let sizeAcc = 0;
    let fileCountAcc = 0;

    walkStream.on('data', (entry: fswalk.Entry) => {
        if (entry.stats?.isFile() || entry.stats?.isSymbolicLink()) {
            sizeAcc += entry.stats.size;
            fileCountAcc += 1;
        }
    });

    return new Promise<{ totalSize: number; fileCount: number; }>((resolve, reject) => {
        walkStream.on('end', () => {
            resolve({
                totalSize: sizeAcc,
                fileCount: fileCountAcc
            });
        });
        walkStream.on('error', (err) => reject(err));
    });
}


export async function* iterFileContents(fpath: string, bs: number = 4 * 1024 * 1024) {
    const fd = await fsp.open(fpath, 'r');

    const buff = Buffer.allocUnsafe(bs);
    let bytesRead = 0;

    try {
        while ((bytesRead = (await fd.read(buff, 0, buff.byteLength, null)).bytesRead) > 0) {
            yield buff.subarray(0, bytesRead);
        }
    } finally {
        fd.close().catch(() => null);
    }
}
