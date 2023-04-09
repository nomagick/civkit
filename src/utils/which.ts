import fsp from 'fs/promises';
import path from 'path';

export async function which(cmd: string) {
    const PATH = process.env.PATH?.split(':') ??
        ['/sbin', '/bin', '/usr/sbin', '/usr/bin', '/usr/local/sbin', '/usr/local/bin'];

    for (const dir of PATH) {
        const thisPath = path.join(dir, cmd);
        const ok = await fsp.access(thisPath, fsp.constants.X_OK).then(() => true).catch(() => false);

        if (ok) {
            return thisPath;
        }
    }

    return undefined;
}
