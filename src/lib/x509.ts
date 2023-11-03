import crypto, { createPrivateKey, KeyObject, randomBytes, webcrypto } from 'crypto';
import { AsyncService } from './async-service';
import { LoggerInterface } from './logger';
import fsp from 'fs/promises';
import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import {
    BasicConstraintsExtension,
    Extension,
    KeyUsageFlags,
    KeyUsagesExtension,
    SubjectKeyIdentifierExtension,
    X509Certificate, X509CertificateCreateParams,
    X509CertificateCreateSelfSignedParams, X509CertificateCreateWithKeyParams,
    X509CertificateGenerator, X509ChainBuilder, cryptoProvider
} from '@peculiar/x509';
import { PromiseThrottle } from './throttle';
import { HashManager } from './hash';
import { isIP } from 'net';
export * as x509 from '@peculiar/x509';

cryptoProvider.set(webcrypto as any);

export interface CertificateFile {
    name?: string;
    cert: string;
    key: string;
    passphrase?: string;
    fingerprint?: string;
}

export interface Certificate {
    name: string,
    cert: crypto.X509Certificate,
    x5t: string;
    'x5t#S256': string;
    certRaw: Buffer | string,
    key?: crypto.KeyObject,
    keyRaw?: Buffer | string;
}

function looksLikeCertFilePath(text: string) {
    if (typeof text !== 'string') {
        return false;
    }

    const lower = text.toLowerCase();

    return lower.length < 1024 &&
        !lower.includes('\n') &&
        (lower.endsWith('.pem') || lower.endsWith('.crt') || lower.endsWith('.key'));
}

export function parsePEM(text: string) {

    return Array.from(
        text.matchAll(/-----BEGIN (?<section>.*)-----\n(?<content>[^-]*?)\n-----END (\k<section>)-----/g)
    ).filter(x => x.groups).map((x) => x.groups) as Array<{ section: string; content: string; }>;
}

export function recoverPEM(section: string, content: string) {
    return `-----BEGIN ${section.toUpperCase()}-----\n${content}\n-----END ${section.toUpperCase()}-----`;
}

const sha1Hasher = new HashManager('sha1', 'base64url');
const sha256Hasher = new HashManager('sha256', 'base64url');

export abstract class AbstractX509Manager extends AsyncService {

    abstract logger: LoggerInterface;

    abstract certificateInput: CertificateFile[];

    certificates!: Certificate[];

    dirWatchers = new Map<string, fs.FSWatcher>();

    override async init() {
        if (!this.certificateInput) {
            throw new Error('Property certificateInput is required for x509Manager to work properly');
        }

        this.certificates = (await Promise.all(this.certificateInput.map(async (x) => {
            let name = x.name;
            let certContent;
            if (looksLikeCertFilePath(x.cert)) {
                if (!name) {
                    name = path.basename(x.cert);
                }
                certContent = await fsp.readFile(path.resolve(x.cert));
            } else {
                certContent = x.cert;
            }
            try {
                const cert = new crypto.X509Certificate(certContent);
                if (!name) {
                    name = cert.subject;
                }
                let key;
                let keyContent;
                if (looksLikeCertFilePath(x.key)) {
                    keyContent = await fsp.readFile(path.resolve(x.key));
                } else {
                    keyContent = x.key;
                }
                if (x.key && keyContent) {
                    key = crypto.createPrivateKey({
                        key: keyContent,
                        passphrase: x.passphrase || undefined,
                    });
                    if (!cert.checkPrivateKey(key)) {
                        this.logger.error(`Invalid key for certificate ${name}`);
                        key = undefined;
                        keyContent = undefined;
                    }
                } else {
                    this.logger.warn(`No key for certificate ${name}`);
                }

                return {
                    name,
                    cert,
                    x5t: sha1Hasher.hash(cert.raw),
                    'x5t#S256': sha256Hasher.hash(cert.raw),
                    certRaw: certContent,
                    key,
                    keyRaw: keyContent
                };
            } catch (err) {
                this.logger.error(`Failed to load certificate(${name})`, { err });
                return undefined;
            }
        }))).filter(Boolean) as Certificate[];
    }

    filterValidCertificates() {
        return this.certificates.filter((x) => {

            const from = new Date(x.cert.validFrom);
            const to = new Date(x.cert.validTo);
            const now = new Date();

            return now >= from && now < to;
        });
    }

    getCertificateForDataSigning() {
        return this.filterValidCertificates().find((x) => x.key) as Required<Certificate> | undefined;
    }

    getCertificateByName(name: string, keyRequired?: '' | false): Certificate | undefined;
    getCertificateByName(name: string, keyRequired: string | true): Required<Certificate> | undefined;
    getCertificateByName(name: string, keyRequired: string | boolean = true) {
        return this.filterValidCertificates().find((x) => (keyRequired ? x.key : true) && x.name === name);
    }

    getCertificates(...claims: string[]) {
        if (!claims.length) {
            return this.filterValidCertificates();
        }

        return this.filterValidCertificates().filter((x) => {
            const vecs = [
                ...x.cert.subject.split('\n'),
                ...(x.cert.subjectAltName?.split(', ') || []),
                ...(x.cert.keyUsage || [])
            ];

            return _.intersection(claims, vecs).length;
        });
    }

    getCertificatesByHostname(hostname: string, keyRequired?: '' | false): Certificate[];
    getCertificatesByHostname(hostname: string, keyRequired: string | true): Array<Required<Certificate>>;
    getCertificatesByHostname(hostname: string, keyRequired: string | boolean = true) {
        const vec = hostname.split('.');
        vec[0] = '*';
        const wildcardHostname = vec.join('.');
        const certs = this.getCertificates(
            `DNS:${hostname}`, `CN=${hostname}`,
            `DNS:${wildcardHostname}`, `CN=${wildcardHostname}`,
            ...isIP(hostname) ? [`IP Address:${hostname}`, `CN=${hostname}`] : []
        );

        if (keyRequired) {
            return certs.filter((x) => x.key) as Array<Required<Certificate>>;
        }

        return certs;
    }

    protected async loadCertificatesFromSingleDirectory(
        dir: string, mode: 'withoutCA' | 'withCA' | 'onlyCA') {
        const subDirEntries = await fsp.readdir(dir, { withFileTypes: true, encoding: 'utf-8' });
        const subDirFiles = (await Promise.all(subDirEntries.map(async (x) => {
            const fpath = path.resolve(dir, x.name);
            if (x.isFile()) {
                return fpath;
            }

            if (x.isSymbolicLink()) {
                const fstat = await fsp.stat(fpath);
                if (fstat.isFile()) {
                    return fpath;
                }
            }

            return;
        }))).filter(Boolean) as string[];

        const pemRegExp = /(pem|ce?rt|key|ca)$/i;
        const pemFiles = subDirFiles.filter((x) => pemRegExp.test(x));

        const pemChunks = [];

        for (const pemFile of pemFiles) {
            const fileContent = await fsp.readFile(pemFile, { encoding: 'utf-8' });
            pemChunks.push(...parsePEM(fileContent));
        }

        const certificatePEMChunks = pemChunks.filter((x) => x?.section.toUpperCase().includes('CERTIFICATE'))
            .map((x) => recoverPEM(x.section, x.content));
        const privateKeyPEMChunks = pemChunks.filter((x) => x?.section.toUpperCase().includes('PRIVATE KEY'))
            .map((x) => recoverPEM(x.section, x.content));

        const parsedCertificatesX509 = certificatePEMChunks.map((x) => new X509Certificate(x));
        const parsedPrivateKeysNative = privateKeyPEMChunks.map((x) => createPrivateKey(x));
        let leafCertificates: typeof parsedCertificatesX509;

        switch (mode) {
            case 'withCA': {
                leafCertificates = parsedCertificatesX509;
                break;
            }
            case 'onlyCA': {
                leafCertificates = parsedCertificatesX509.filter(
                    (x) => x.getExtension(BasicConstraintsExtension)?.ca === true
                );
                break;
            }
            case 'withoutCA':
            default: {
                leafCertificates = parsedCertificatesX509.filter(
                    (x) => x.getExtension(BasicConstraintsExtension)?.ca !== true
                );
                break;
            }
        }

        const chainBuilder = new X509ChainBuilder({ certificates: parsedCertificatesX509 });


        return Promise.all(
            leafCertificates.map(
                async (cert) => {
                    const chain = await chainBuilder.build(cert);
                    const nativeCert = new crypto.X509Certificate(cert.toString('pem'));

                    const key = parsedPrivateKeysNative.find((k) => nativeCert.checkPrivateKey(k));

                    return {
                        cert: chain.map((x) => x.toString('pem')).join('\n'),
                        key: key?.export({ format: 'pem', type: 'pkcs8' }) as string,
                        // eslint-disable-next-line @typescript-eslint/no-magic-numbers
                        name: `${path.basename(dir)}${leafCertificates.length > 1 ? `-${nativeCert.fingerprint.slice(-5)}` : ''}`,
                        fingerprint: nativeCert.fingerprint,
                    };
                }
            )
        );
    }

    async discoverCertificates(pathToDiscover: string, mode: 'withoutCA' | 'withCA' | 'onlyCA' = 'withoutCA') {
        if (!pathToDiscover) {
            return [];
        }
        const dirPath = path.resolve(pathToDiscover);
        let dirContents;
        try {
            dirContents = await fsp.readdir(dirPath, { withFileTypes: true, encoding: 'utf-8' });
        } catch (err) {
            this.logger.warn(`Failed to discover from directory ${dirPath}`, { err });
            return [];
        }

        const promiseThrottle = new PromiseThrottle(16);

        const subDirs = (await Promise.all(
            dirContents.map(async (x) => {
                const fpath = path.resolve(pathToDiscover, x.name);
                if (x.isDirectory()) {
                    return fpath;
                }

                if (x.isSymbolicLink()) {
                    await promiseThrottle.acquire();
                    const fstat = await fsp.stat(fpath).finally(() => promiseThrottle.release());
                    if (fstat.isDirectory()) {
                        return fpath;
                    }
                }

                return;
            }))
        ).filter(Boolean);

        const dirsToSearch = [...subDirs, dirPath] as string[];

        const certs = [];

        for (const dir of dirsToSearch) {
            const dirChunks = await this.loadCertificatesFromSingleDirectory(dir, mode);
            certs.push(...dirChunks);
        }

        this.emit('discovery', certs);

        return certs as CertificateFile[];
    }

    async watchForCertificates(pathToWatch: string, mode: 'withoutCA' | 'withCA' | 'onlyCA' = 'withoutCA') {
        if (!pathToWatch) {
            return;
        }
        const dirPath = path.resolve(pathToWatch);
        if (this.dirWatchers.has(dirPath)) {
            return;
        }

        let dirContents;
        try {
            dirContents = await fsp.readdir(dirPath, { withFileTypes: true, encoding: 'utf-8' });
        } catch (err) {
            this.logger.warn(`Failed to watch directory ${dirPath}`, { err });
            throw err;
        }

        const promiseThrottle = new PromiseThrottle(16);

        const subDirs = (await Promise.all(
            dirContents.map(async (x) => {
                const fpath = path.resolve(pathToWatch, x.name);
                if (x.isDirectory()) {
                    return fpath;
                }

                if (x.isSymbolicLink()) {
                    await promiseThrottle.acquire();
                    const fstat = await fsp.stat(fpath).finally(() => promiseThrottle.release());
                    if (fstat.isDirectory()) {
                        return fpath;
                    }
                }

                return;
            }))
        ).filter(Boolean) as string[];

        const dirWatcher = fs.watch(dirPath, { encoding: 'utf-8', persistent: false });

        dirWatcher.on('change', async (eventType, filename: string) => {
            if (eventType !== 'rename') {
                return;
            }

            const thePath = path.resolve(dirPath, filename);
            const fstat = await fsp.stat(thePath).catch(() => undefined);
            if (!fstat?.isDirectory()) {
                return;
            }

            const certificates = await this.loadCertificatesFromSingleDirectory(thePath, mode);
            if (certificates.length) {
                this.emit('update', certificates, thePath);
            }

            this.watchSingleDirectory(thePath, mode);
        });

        this.watchSingleDirectory(dirPath, mode);
        this.once('clear-watchers', () => dirWatcher.close());

        for (const dir of subDirs) {
            this.watchSingleDirectory(dir, mode);
        }
    }

    stopWatching() {
        for (const x of this.dirWatchers.values()) {
            x.close();
        }
        this.dirWatchers.clear();
        this.emit('clear-watchers');
    }

    protected watchSingleDirectory(dir: string, mode: 'withoutCA' | 'withCA' | 'onlyCA') {
        if (this.dirWatchers.has(dir)) {
            return this.dirWatchers.get(dir);
        }

        const thePath = path.resolve(dir);
        const discoveryRoutine = async () => {
            const certs = await this.loadCertificatesFromSingleDirectory(dir, mode);
            this.emit('discovery', certs);
            this.emit('update', certs, thePath);
        };

        const dirWatcher = fs.watch(dir, { encoding: 'utf-8', persistent: false });
        let debounceTimeout: ReturnType<typeof setTimeout>;

        dirWatcher.on('change', (_eventType, _filename: string) => {
            if (debounceTimeout) {
                clearTimeout(debounceTimeout);
            }
            debounceTimeout = setTimeout(discoveryRoutine, 1000);
        });

        this.dirWatchers.set(dir, dirWatcher);

        return dirWatcher;
    }

    dumpBundle(...claims: string[]) {
        const certs = this.getCertificates(...claims);

        return _(certs)
            .map(
                (x) => parsePEM(
                    typeof x.certRaw === 'string' ? x.certRaw : x.certRaw.toString('base64')
                )
            )
            .flatten()
            .uniqBy((x) => x.content)
            .map((x) => recoverPEM(x.section, x.content))
            .join('\n');
    }
}

export interface AbstractX509Manager {
    on(event: 'update', listener: (certs: CertificateFile[], dirPath: string) => void): this;
    on(event: 'discovery', listener: (certs: CertificateFile[]) => void): this;
    on(event: 'clear-watchers', listener: () => void): this;

    on(event: 'ready', listener: () => void): this;
    on(event: 'crippled', listener: (err?: Error | any) => void): this;
    on(event: 'pending', listener: (err: Error) => void): this;
    on(event: 'stand-down', listener: (err: Error) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
}

function specialExtensionMerger(a?: Extension[], b?: Extension[]) {
    const tgt = a || [];
    if (!b?.length) {
        return tgt;
    }

    for (const ext of b) {
        const existing = tgt.findIndex((x) => x.type === ext.type);

        if (existing !== -1) {
            tgt.splice(existing, 1, ext);
        } else {
            tgt.push(ext);
        }
    }

    return tgt;
}

export abstract class AbstractX509CertificateAuthority extends AbstractX509Manager {

    keyGenProfiles: { [key: string]: webcrypto.RsaHashedKeyGenParams | webcrypto.EcdsaParams; } = {
        'rsa-2048': {
            name: 'RSASSA-PKCS1-v1_5',
            hash: 'SHA-256',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1])
        } as webcrypto.RsaHashedKeyGenParams,
        'ec-256': {
            name: 'ECDSA',
            hash: 'SHA-256',
            namedCurve: 'P-256'
        } as webcrypto.EcdsaParams,
    };

    getCACertificateForSigning(...claims: string[]) {
        return this.getCertificates(...claims)
            .find((x) => x.cert.ca && x.key) as Required<Certificate>;
    }

    async createSelfSignedCACertificate(
        partialCA?: Partial<X509CertificateCreateSelfSignedParams>,
        profile: keyof this['keyGenProfiles'] = 'rsa-2048',
    ) {
        const keyGenProfile = this.keyGenProfiles[profile as string];
        const keyPair = await webcrypto.subtle.generateKey(
            keyGenProfile, true, ['sign', 'verify']) as webcrypto.CryptoKeyPair;

        const finalOptions = {
            signingAlgorithm: keyGenProfile,
            serialNumber: randomBytes(16).toString('hex'),
            notBefore: new Date(),
            // eslint-disable-next-line @typescript-eslint/no-magic-numbers
            notAfter: new Date(Date.now() + 365 * 3600 * 24 * 1000),
            keys: keyPair,
            ...partialCA,
            extensions: specialExtensionMerger([
                new BasicConstraintsExtension(true, undefined, true),
                new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
                await SubjectKeyIdentifierExtension.create(keyPair.publicKey, false),
            ], partialCA?.extensions),
        };

        const certificate = await X509CertificateGenerator.createSelfSigned(finalOptions);

        return {
            certificate,
            keyPair: finalOptions.keys
        };
    }

    selectAlgorithm(key: KeyObject) {
        const keyAlg = key.asymmetricKeyType;
        if (keyAlg === 'rsa') {
            return this.keyGenProfiles['rsa-2048'];
        }
        if (keyAlg === 'ec') {
            switch (key.asymmetricKeyDetails!.namedCurve) {
                case 'prime256v1': {
                    return this.keyGenProfiles['ec-256'];
                }
                default: {
                    throw new Error(`Unsupported key algorithm ec ${key.asymmetricKeyDetails!.namedCurve}`);
                }
            }
        }

        throw new Error(`Unsupported key algorithm ${keyAlg}`);
    }

    async createCertificate(
        draftCertificate: Partial<X509CertificateCreateParams>,
        ca: Certificate | string[] = [],
        profileName?: keyof this['keyGenProfiles'],
    ) {
        const caCert = Array.isArray(ca) ? this.getCACertificateForSigning(...ca) : ca as Certificate | undefined;

        if (!caCert) {
            throw new Error('No CA certificate matched');
        }

        const selectedProfile = Reflect.get(this.keyGenProfiles, profileName || 'default') ||
            this.selectAlgorithm(caCert.key!);
        const webCryptoCaKey = await webcrypto.subtle.importKey(
            'pkcs8',
            caCert.key!.export({ type: 'pkcs8', format: 'der' }) as Buffer,
            selectedProfile,
            true,
            ['sign'],
        );

        const keyPair = await webcrypto.subtle.generateKey(
            selectedProfile, true, ['sign', 'verify']) as webcrypto.CryptoKeyPair;

        const issuerCert = new X509Certificate(caCert.certRaw);

        const finalOptions: X509CertificateCreateWithKeyParams = {
            signingAlgorithm: selectedProfile,
            serialNumber: randomBytes(16).toString('hex'),
            notBefore: new Date(),
            // eslint-disable-next-line @typescript-eslint/no-magic-numbers
            notAfter: new Date(Date.now() + 365 * 3600 * 24 * 1000),
            signingKey: webCryptoCaKey,
            publicKey: keyPair.publicKey,
            issuer: issuerCert.subject,
            ...draftCertificate,
            extensions: specialExtensionMerger([
                new BasicConstraintsExtension(false, undefined, true),
                new KeyUsagesExtension(
                    KeyUsageFlags.digitalSignature
                    | KeyUsageFlags.nonRepudiation,
                    true),
                await SubjectKeyIdentifierExtension.create(keyPair.publicKey, false),
            ], draftCertificate.extensions),
        };

        const certificate = await X509CertificateGenerator.create(finalOptions);

        const bundle = parsePEM(caCert.certRaw.toString())
            .filter((x) => x.section.toLowerCase() === 'certificate')
            .map((x) => {
                return new X509Certificate(recoverPEM(x.section, x.content));
            });

        const chain = new X509ChainBuilder({
            certificates: bundle
        });

        return {
            certificate,
            keyPair,
            chain: await chain.build(certificate)
        };
    }

    dumpCertificate(internalFormat: Awaited<ReturnType<this['createCertificate']>>): CertificateFile {
        const privateKeyPEM = crypto.KeyObject.from(internalFormat.keyPair.privateKey)
            .export({ type: 'pkcs8', format: 'pem' }) as string;

        const chainPEM = internalFormat.chain.map((x) => x.toString('pem')).join('\n');

        return {
            cert: chainPEM,
            key: privateKeyPEM,
        };

    }

    override discoverCertificates(pathToDiscover: string) {
        return super.discoverCertificates(pathToDiscover, 'onlyCA');
    }

    override watchForCertificates(pathToDiscover: string) {
        return super.watchForCertificates(pathToDiscover, 'onlyCA');
    }

}
