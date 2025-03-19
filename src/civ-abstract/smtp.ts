import nodemailer from 'nodemailer';
import { SMTPServer, SMTPServerOptions, SMTPServerDataStream, SMTPServerSession } from 'smtp-server';
import type { Address } from 'nodemailer/lib/mailer';
import type tls from 'tls';
import _ from 'lodash';
import dnsp from 'dns/promises';
import { AsyncService, Defer, FancyFile, LoggerInterface, SYSTEM_CPU_COUNT } from '../lib';

import { AbstractX509Manager } from '../lib/x509';
import { AbstractTempFileManger } from '../lib/temp';
import { which } from '../utils/which';

export interface SMTPConfig {
    debug?: boolean;
    mta?: {
        host: string;
        port: number;
        ssl?: boolean;
        startTls?: boolean;
        tls?: tls.ConnectionOptions;
        user?: string;
        pass?: string;
        ca?: tls.TlsOptions['ca'];
    } | 'sendmail' | 'none' | 'stream' | 'json';
    from?: string;
    hostname?: string;
}

const SMTPS_PORT = 465;
const SMTP_STARTTLS_PORT = 587;
const SMTP_PORT = 25;
const ALTERNATIVE_SMTP_PORT = 2525;

export abstract class AbstractSMTPSenderService extends AsyncService {
    protected abstract logger: LoggerInterface;

    TATransport?: nodemailer.Transporter;

    transportCache: Map<string, Promise<nodemailer.Transporter>> = new Map();

    abstract config: SMTPConfig;

    override async init() {
        await this.dependencyReady();

        if (this.config) {
            const taConfig = this.config.mta;

            if (taConfig) {
                this.useTA(taConfig);
            }
        }

        this.emit('ready');
    }

    async useTA(taConfig?: SMTPConfig['mta'] | null) {
        if (this.TATransport) {
            this.TATransport.close();
            this.TATransport = undefined;
        }

        if (!taConfig) {
            return this.TATransport;
        }

        if (typeof taConfig === 'string' && taConfig.startsWith('sendmail')) {
            const sendmailPath = await which('sendmail');
            if (!sendmailPath) {
                throw new Error(`Invalid TA for ${this.constructor.name}: sendmail not found in system`);
            }

            this.TATransport = nodemailer.createTransport({
                sendmail: true,
                newline: 'unix',
                path: sendmailPath,
                logger: this.config?.debug ? this.logger : undefined,
            } as any);

        } else if (typeof taConfig === 'string' && taConfig === 'stream' || taConfig === 'json') {
            this.TATransport = nodemailer.createTransport({
                jsonTransport: taConfig === 'json',
                streamTransport: taConfig === 'stream',
                newline: 'unix',
                logger: this.config?.debug ? this.logger : undefined,
            } as any);
        } else if (typeof taConfig === 'object') {
            const opts: any = {
                host: taConfig.host,
                port: taConfig.port,
                secure: taConfig.ssl,
                requireTLS: taConfig.startTls,
                tls: {
                    rejectUnauthorized: true,
                    ...taConfig.tls
                },
                auth: {
                    user: taConfig.user,
                    pass: taConfig.pass
                },
                name: this.config?.hostname,
                pool: true,
                maxMessages: Infinity,
                maxConnections: 5 * SYSTEM_CPU_COUNT,
                disableUrlAccess: true,
                socketTimeout: 60 * 1000,
                logger: this.config?.debug ? this.logger.child({ service: `${this.constructor.name} MTA:${taConfig.host}` }) : undefined,
                ca: ''
            };
            if (taConfig.ca) {
                opts.tls = {
                    ca: taConfig.ca,
                };
            }
            this.TATransport = nodemailer.createTransport(opts);
            await this.TATransport.verify();
        }

        return this.TATransport;
    }

    parseEmail(input: string | { name: string; address: string; }) {
        let address = typeof input === 'string' ? input : input.address;
        let displayName = typeof input === 'string' ? undefined : input.name;
        if (typeof input == 'string') {
            const match = input.match(/^(.+)\s*<(.+)>$/);
            if (match) {
                displayName = match[1];
                address = match[2];
            }
        }

        const domain = address.split('@')[1];

        if (!domain) {
            return undefined;
        }

        return {
            name: displayName,
            email: address,
            domain
        };
    }

    async getTransport(inputDomain: string, thisServerName?: string) {
        const domain = inputDomain.toLowerCase();
        const cached = this.transportCache.get(domain);

        if (cached) {
            return cached;
        }

        const deferred = Defer();

        this.transportCache.set(domain, deferred.promise);
        const errors: unknown[] = [];

        const asyncTasks = async () => {
            const mxRecords = await dnsp.resolve(domain, 'MX');
            let resolved = false;
            for (const mx of _.sortBy(mxRecords, 'priority')) {
                const targetHost = mx.exchange.toString();
                await Promise.all([
                    { port: SMTP_PORT },
                    { port: ALTERNATIVE_SMTP_PORT },
                    { port: SMTPS_PORT, secure: true },
                    { port: SMTP_STARTTLS_PORT, requireTLS: true },
                ].map(async (x) => {
                    let transport: nodemailer.Transporter | undefined;
                    try {
                        transport = nodemailer.createTransport({
                            host: targetHost,
                            ...x,
                            name: thisServerName || this.config?.hostname,
                            pool: true,
                            maxMessages: Infinity,
                            maxConnections: 5 * SYSTEM_CPU_COUNT,
                            disableUrlAccess: true,
                            socketTimeout: 60 * 1000,
                            dnsTimeout: 10 * 1000,
                            connectionTimeout: 10 * 1000,
                            logger: this.config?.debug ? this.logger.child({ service: `${this.constructor.name} mailto:${inputDomain}:${x.port}` }) : undefined,
                        } as any);
                        await transport.verify();
                        deferred.resolve(transport);
                        resolved = true;

                        return transport;
                    } catch (err) {
                        errors.push(err);
                    } finally {
                        if (transport) {
                            deferred.promise.catch(() => undefined).then((r) => {
                                if (transport && r !== transport) {
                                    transport.close();
                                }
                            });
                        }
                    }
                    return undefined;
                }));

                if (resolved) {
                    break;
                }
            }
        };

        asyncTasks().catch((err) => {
            errors.push(err);
        }).finally(() => {
            const err = new Error(`Cannot create transport for ${domain}: ${errors.join(', ')}`);
            err.cause = errors[errors.length - 1];
            (err as any).errors = errors;
            deferred.reject(err);
        });

        deferred.promise.then((r) => {
            this.logger.debug(`Transport resolved for ${domain}`);
            r.once('idle', async () => {
                this.logger.warn('Closing transport due to idle');
                r.close();
                if ((await this.transportCache.get(domain)) === r) {
                    this.transportCache.delete(domain);
                }
            });
        });

        return deferred.promise;
    }

    async sendMail(inputMailOptions: nodemailer.SendMailOptions, serverName?: string) {
        const mailOptions = {
            ...inputMailOptions,
            from: inputMailOptions.from || this.config?.from,
        };

        if (!mailOptions.from) {
            throw new Error('No from address specified');
        }

        this.logger.debug(`Sending email to ${this.countRecipients(inputMailOptions)} recipients...`);

        if (this.TATransport) {
            return this.TATransport.sendMail(mailOptions);
        }

        const r: Record<string, typeof mailOptions> = {};
        for (const [domain, opts] of Object.entries(this.categorize(mailOptions))) {
            const transport = await this.getTransport(domain, serverName).catch((err) => {
                this.logger.warn(`Failed to get transport for ${domain}`, { err });
            });

            if (!transport) {
                continue;
            }

            r[domain] = await transport.sendMail(opts);
        }

        return r;
    }

    protected categorize(mailOptions: nodemailer.SendMailOptions): Record<string, nodemailer.SendMailOptions> {
        type CategoryType = {
            to?: Array<string | Address>;
            cc?: Array<string | Address>;
            bcc?: Array<string | Address>;
        };

        const domains: Record<string, CategoryType> = {};

        // This is required because we want to override the params.
        const baseObj = {
            to: undefined,
            cc: undefined,
            bcc: undefined
        };

        let nrcpts = 0;
        for (const x of ['to', 'cc', 'bcc'] as const) {
            const inputRcpts = mailOptions[x];
            if (!inputRcpts) {
                continue;
            }
            const rcpts = Array.isArray(inputRcpts) ? inputRcpts : [inputRcpts];
            for (const rcpt of rcpts) {
                const parsed = this.parseEmail(rcpt);
                if (!parsed) {
                    continue;
                }
                nrcpts++;
                const domain = parsed.domain;
                const domainRCPT = domains[domain] || { ...baseObj };
                if (!domainRCPT[x]) {
                    domainRCPT[x] = [];
                }
                domainRCPT[x]!.push(rcpt);
                domains[domain] = domainRCPT;
            }
        }

        if (!nrcpts) {
            throw new Error('No valid recipient found');
        }

        return _.mapValues(domains, (v) => {
            return {
                ...mailOptions,
                ...v,
            };
        });
    }

    protected countRecipients(opts: nodemailer.SendMailOptions) {
        let i = 0;
        for (const x of ['to', 'cc', 'bcc'] as const) {
            if (Array.isArray(opts[x])) {
                i += (opts[x] as any[]).length;
            } else if (opts[x]) {
                i += 1;
            }
        }

        return i;
    }
}


export abstract class AbstractSMTPServerService extends AsyncService {
    protected abstract logger: LoggerInterface;

    TATransport?: nodemailer.Transporter;

    transportCache: Map<string, Promise<nodemailer.Transporter>> = new Map();

    protected abstract config: SMTPConfig;
    protected abstract x509: AbstractX509Manager;
    protected abstract tmpFileManager: AbstractTempFileManger;

    servers: Map<number, SMTPServer> = new Map();

    override async init() {
        await this.dependencyReady();

        this.emit('ready');
    }

    async createServer(port: number = SMTP_PORT, opts?: SMTPServerOptions) {
        const tlsMixin: Partial<SMTPServerOptions> = {};

        if (this.config?.hostname) {
            const certs = this.x509.getCertificatesByHostname(this.config.hostname);
            if (certs.length) {
                const cert = certs[0];

                tlsMixin.key = cert.keyRaw;
                tlsMixin.cert = cert.certRaw;
                tlsMixin.hideSTARTTLS = false;

                if (port === SMTPS_PORT) {
                    tlsMixin.secure = true;
                }
            }
        }

        const server = new SMTPServer({
            name: this.config?.hostname,
            size: 1024 * 1024 * 10,  // 10MB
            authMethods: ['CRAM-MD5', 'PLAIN', 'LOGIN', 'XOAUTH2'],
            authOptional: true,
            secure: false,
            hideSTARTTLS: true,
            disableReverseLookup: true,
            closeTimeout: 1000,
            logger: this.config?.debug ? this.logger.child({ service: `${this.constructor.name} smtp-srv:${port}` }) as any : undefined,
            ...{ maxAllowedUnauthenticatedCommands: Infinity },
            ...tlsMixin,
            ...opts,
            onAuth: (_auth, session, cb) => {
                // Not care about auth
                cb(null, { user: session.hostNameAppearsAs });
            },
            onConnect: (_session, cb) => {
                // Not filtering client IP
                cb(null);
            },
            onMailFrom: async (address, session, cb) => {
                try {
                    const r = await this.validateFrom(address.address, session, address.args as any);
                    if (r) {
                        cb(null);
                    } else {
                        cb(new Error('Rejected'));
                    }
                } catch (err: any) {
                    cb(err);
                }
            },
            onRcptTo: async (address, session, cb) => {
                try {
                    const r = await this.validateRCPTTo(address.address, session, address.args as any);
                    if (r) {
                        cb(null);
                    } else {
                        cb(new Error('Rejected'));
                    }
                } catch (err: any) {
                    cb(err);
                }
            },
            onData: (dataStream, session, cb) => {
                this.onMail(dataStream, session);
                cb(null);
            },
        });

        this.servers.set(port, server);

        server.once('close', () => {
            if (this.servers.get(port) === server) {
                this.servers.delete(port);
            }
        });

        return new Promise<SMTPServer>((resolve, _reject) => {
            server.listen(port, () => resolve(server));
        });
    }

    closeServer(port: number = SMTP_PORT) {
        const server = this.servers.get(port);
        if (!server) {
            return;
        }

        return new Promise<void>((resolve) => server.close(resolve));
    }

    closeAll() {
        return Promise.all(
            [...this.servers.values()]
                .map(
                    (x) => new Promise<void>(
                        (resolve) => x.close(resolve)
                    )
                )
        );
    }

    async validateFrom(
        address: string,
        session: SMTPServerSession,
        addressArgs: { [k: string]: string; }
    ) {

        void address, session, addressArgs;

        return true;
    }

    async validateRCPTTo(
        address: string,
        session: SMTPServerSession,
        addressArgs: { [k: string]: string; }
    ) {

        void address, session, addressArgs;

        return true;
    }

    onMail(dataStream: SMTPServerDataStream, session: SMTPServerSession) {
        const fancyFile = this.tmpFileManager.cacheReadable(dataStream);
        const mail = {
            from: session.envelope.mailFrom ? session.envelope.mailFrom.address : undefined,
            to: session.envelope.rcptTo.map((x) => x.address),
            context: { ...session },
            body: fancyFile,
        };

        this.emit('mail', mail);

        return mail as Mail;
    }
}

export interface Mail {
    from?: string;
    to: string[];
    context: SMTPServerSession;
    body: FancyFile;
}

export interface SMTPReceiverService {
    on(event: 'mail', listener: (mail: Mail) => void): this;
    on(event: 'ready', listener: () => void): this;
    on(event: 'crippled', listener: (err?: Error | any) => void): this;
    on(event: 'pending', listener: (err: Error) => void): this;
    on(event: 'stand-down', listener: (err: Error) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
}
