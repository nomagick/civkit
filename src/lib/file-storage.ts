import { Readable, PassThrough } from 'stream';

import path from 'path';

import { FancyFile } from './fancy-file';
import { promisify } from 'util';

import fsp from 'fs/promises';
import fs from 'fs';
import { randomBytes as originalRandomBytes } from 'crypto';
import { AsyncService } from './async-service';
import { ensureDir } from '../utils/file-system';
import { pathToFileURL } from 'url';

const randomBytes = promisify(originalRandomBytes);


export abstract class AbstractStorageManager extends AsyncService {
    abstract storageRoot: string;

    dirGrid: Map<string, boolean> = new Map();
    defaultFileName: string = 'DEFAULT';

    override async init() {
        await this._ensureDir('');
    }

    pathScatter(dirName: string) {
        const l1 = dirName.slice(0, 2);
        const l2 = dirName.slice(2, 4);
        const l3 = dirName.slice(4);

        return path.join(l1, l2, l3);
    }


    _ensureDir(dir: string) {
        if (this.dirGrid.get(dir)) {
            return Promise.resolve();
        }

        return ensureDir(path.join(this.storageRoot, dir)).then(() => {
            this.dirGrid.set(dir, true);
        });
    }

    async securePathFor(pathName: string, fileName: string = this.defaultFileName) {
        await this._ensureDir(this.pathScatter(pathName));

        return this.fullPath(pathName, fileName);
    }

    _statOf(fpath: string): Promise<fs.Stats> {
        return fsp.stat(fpath);
    }

    async _sizeOf(targetPath: string) {
        const stat = await this._statOf(targetPath);

        return stat.size;
    }

    async alreadyStored(pathName: string, fileName = this.defaultFileName, size?: number) {
        const targetPath = this.fullPath(pathName, fileName);
        let fStat;
        try {
            fStat = await this._statOf(targetPath);
        } catch (err) {
            return false;
        }
        if (!fStat || !fStat.isFile()) {
            return false;
        }
        if (fStat.size === size) {
            return true;
        }
        // let curSha256Sum = await sha256Hasher.hashStream(fs.createReadStream(targetPath));
        // if (curSha256Sum === sha256Sum) {
        //     return true;
        // }
        // return false;

        return true;
    }

    accessLocalFile(dirName: string, fileName: string = this.defaultFileName, overrideFileName?: string) {
        return FancyFile.auto(pathToFileURL(this.fullPath(dirName, fileName)), { fileName: overrideFileName });
    }

    async storeFancyFile(file: FancyFile, dirName?: string, fileName: string = this.defaultFileName) {
        if (!file) {
            throw new Error('No file to store.');
        }
        let targetDir = dirName;
        if (!targetDir) {
            targetDir = await this.randomName();
        }

        const theStream: Readable = await file.createReadStream();
        const targetPath = await this.securePathFor(targetDir, fileName);

        const targetPromise = new Promise<[string, string]>((resolve, reject) => {
            const targetStream = fs.createWriteStream(targetPath);
            theStream.once('error', (err) => {
                reject(err);
            });
            targetStream.once('error', (err: Error) => {
                reject(err);
            });
            targetStream.once('finish', () => {
                resolve([targetDir!, fileName!]);
            });
            theStream.pipe(targetStream);
        });

        return targetPromise;
    }


    async storeReadable(stream: Readable, dirName?: string, fileName: string = this.defaultFileName) {
        if (!stream) {
            throw new Error('No stream to store.');
        }
        stream.pause();
        let targetDir = dirName;
        if (!targetDir) {
            targetDir = await this.randomName();
        }
        
        const targetPath = await this.securePathFor(targetDir, fileName);
        const targetStream = fs.createWriteStream(targetPath);

        const targetPromise = new Promise<[string, string]>((resolve, reject) => {
            stream.once('error', (err) => {
                reject(err);
            });
            stream.once('end', () => {
                resolve([targetDir!, fileName!]);
            });
        });
        stream.pipe(targetStream);
        stream.resume();

        return targetPromise;
    }

    storeLocalFile(filePath: string, dirName?: string, fileName: string = this.defaultFileName) {
        const fFile = FancyFile.auto(pathToFileURL(filePath));

        return this.storeFancyFile(fFile, dirName, fileName);
    }

    storeBuffer(buff: Buffer | ArrayBuffer, dirName?: string, fileName: string = this.defaultFileName) {
        const pStream = new PassThrough();
        const r = this.storeReadable(pStream, dirName, fileName);
        pStream.write(buff);
        pStream.end();

        return r;
    }

    erase(dirName: string, fileName: string = this.defaultFileName) {
        const fpath = this.fullPath(dirName, fileName);

        return fsp.unlink(fpath);
    }

    fullPath(dirName: string, fileName: string = this.defaultFileName) {
        if (dirName.indexOf('..') >= 0 || (fileName && fileName.indexOf('..') >= 0)) {
            throw new Error('Illegal path names.');
        }

        const scatteredPath = this.pathScatter(dirName);

        return path.join(this.storageRoot, scatteredPath, this.defaultFileName);
    }

    async randomName() {
        const randomBuff = await randomBytes(24);

        return randomBuff.toString('hex');
    }

    getStream(dirName: string, fileName: string = this.defaultFileName, options?: { start: number; end: number }): Promise<fs.ReadStream> {
        const fPath = this.fullPath(dirName, fileName);

        return this.getLocalStream(fPath, options);
    }

    getLocalStream(fpath: string, options?: { start: number; end: number }): Promise<fs.ReadStream> {
        return new Promise((resolve, reject) => {
            fs.access(fpath, fs.constants.R_OK, (err) => {
                if (err) {
                    return reject(err);
                }

                const theStream = fs.createReadStream(fpath, options);

                return resolve(theStream);
            });
        });
    }

    getFancyFile(dirName: string, fileName: string = this.defaultFileName) {
        const fPath = this.fullPath(dirName, fileName);

        return FancyFile.auto(pathToFileURL(fPath));
    }

}
