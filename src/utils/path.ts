const sep = process.platform === 'win32' ? '\\' : '/';
const sepReg = /[\\/]/gi;

export function urlPathToSystemPath(fpath: string) {

    const pathVec = decodeURI(fpath).split('/').filter((x) => Boolean(x)).join(sep);

    return process.platform === 'win32' ? pathVec : `/${pathVec}`;
}


export function systemPathToUrl(fpath: string, proto: string = 'file') {

    if (fpath.startsWith('\\\\')) {
        const theUrl = new URL(`${proto}://${fpath.replace(/^\\\\/gi, '').split(sepReg).filter((x) => Boolean(x)).join('/')}`);

        return theUrl.toString();
    }

    const pathVec = fpath.split(sepReg).filter((x) => Boolean(x)).join('/');

    const urlVec = new URL(`${proto}:///${pathVec}`);

    return urlVec.toString();
}
