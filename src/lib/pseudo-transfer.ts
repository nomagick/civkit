import _ from 'lodash';
import { EventEmitter } from 'node:stream';
import { ReadableStream } from 'node:stream/web';
import { isTypedArray } from 'node:util/types';
import { MessageChannel, MessagePort, parentPort, threadId } from 'node:worker_threads';
import { AsyncService } from './async-service';
import { Defer, Deferred } from './defer';
import { isPrimitiveLike, marshalErrorLike } from '../utils/lang';
import { deepCloneAndExpose } from '../utils/vectorize';
type Constructor<T = any> = abstract new (...args: any) => T;

export const SYM_PSEUDO_TRANSFERABLE = Symbol('PseudoTransferable');
export const SYM_REMOTE_OBJECT = Symbol('RemoteObject');

type SpecialTraits = 'EventEmitter' | 'Promise' | 'AsyncIterator' | 'thisArg';
export interface PseudoTransferableOptions {
    copyOwnProperty: 'all' | 'none' | 'enumerable' | string[];
    ignoreOwnProperty?: string[];

    marshall?: (input: any) => any;
    unMarshall?: (input: any) => any;

    imitateMethods?: string[];
    imitateSpecialTraits?: SpecialTraits[];
}
export interface PseudoTransferable {
    [SYM_PSEUDO_TRANSFERABLE]: () => PseudoTransferableOptions;
}

type TransferMode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface PseudoTransferProfile {
    path: string[];
    mode: TransferMode;
    traits: SpecialTraits[];
    oid?: string;
    constructorName?: string;
    oMethods?: string[];
}

export interface PseudoTransferRequest {
    type: string | 'remoteFunctionCall' | 'remoteMethodCall' | 'remotePromiseThen' | 'remoteEventEmitter' | 'remoteAsyncIterator' | 'remoteObjectReference';
    port: MessagePort;
    oid?: string;
    fnOid?: string;
    thisArg?: any;
    // thisArgProfile?: PseudoTransferProfile[];
    args?: any[];
    method?: string;
    uuid?: string;
}

export interface PseudoTransferEvent {
    kind: 'resolved' | 'rejected' | 'return' | 'throw' | 'event' | 'next' | 'call';
    data: any;
    dataProfiles?: PseudoTransferProfile[];
    name?: string;
    serial?: number;
}

export function detectSpecialTraits(input: any) {
    if (!input || !['function', 'object'].includes(typeof input)) {
        return [];
    }

    const traits: Array<SpecialTraits> = [];

    if (typeof input.then === 'function') {
        traits.push('Promise');
    }
    if (input instanceof EventEmitter) {
        traits.push('EventEmitter');
    }
    if (typeof input?.[Symbol.asyncIterator] === 'function') {
        traits.push('AsyncIterator');
    }
    if (traits.length) {
        return traits;
    }

    return [];
}

export interface MessagePortLike extends EventEmitter {
    postMessage(message: any, transfer?: any[]): void;
}

const noop = () => undefined;

export abstract class AbstractPseudoTransfer extends AsyncService {

    trackedObjectToSerial = new WeakMap();

    openPorts = new Set();

    pseudoTransferableTypes = new Map<string, Constructor>;

    serial = 0n;

    primaryPort = parentPort;

    portFinalizationRegistry = new FinalizationRegistry((port: MessagePort) => {
        port.close();
    });

    serialToId(n: number | bigint) {
        return `${threadId}__${n}`;
    }

    idToSerial(id: string) {
        const parsed = id.split('__');
        return {
            remote: parseInt(parsed[0]),
            serial: BigInt(parsed[1]),
        };
    }

    track(obj: object) {
        if (!['object', 'function'].includes(typeof obj) || obj === null) {
            throw new Error('Only objects/functions can be tracked.');
        }

        const remoteSerial = Reflect.get(obj, SYM_REMOTE_OBJECT);
        if (remoteSerial) {
            return remoteSerial;
        }

        const n = this.trackedObjectToSerial.get(obj);

        if (n) {
            return this.serialToId(n);
        }

        const newId = ++this.serial;
        this.trackedObjectToSerial.set(obj, newId);

        return this.serialToId(newId);
    }

    expectPseudoTransferableType(type: Constructor) {
        if (this.pseudoTransferableTypes.has(type.name)) {
            throw new Error(`Duplicated type name: ${type.name}`);
        }
        this.pseudoTransferableTypes.set(type.name, type);
    }

    prepareForTransfer(input: any) {
        if ((typeof input !== 'object' && typeof input !== 'function') || !input) {
            return [];
        }

        const profiles: [any, PseudoTransferProfile][] = [];

        const transferSettings: PseudoTransferableOptions | undefined = input[SYM_PSEUDO_TRANSFERABLE]?.();
        const detectedTraits = detectSpecialTraits(input);
        const topTraits: PseudoTransferProfile['traits'] = transferSettings?.imitateSpecialTraits || detectedTraits;

        profiles.push([
            input,
            {
                path: [],
                mode: 7,
                constructorName: input?.constructor?.name,
                traits: topTraits,
                oMethods: transferSettings?.imitateMethods,
            }
        ]);
        for (const [path, val, mode, traits, imitateMethods] of deepVectorizeForTransfer(input, undefined, undefined, topTraits)) {
            profiles.push([
                val,
                {
                    path,
                    mode,
                    constructorName: val?.constructor?.name,
                    traits: traits === null ? [] : traits,
                    oMethods: imitateMethods,
                }
            ]);
        }

        for (const [val, profile] of profiles) {
            if (
                profile.constructorName === 'Function' ||
                profile.traits?.length ||
                profile.oMethods?.length ||
                val?.[SYM_REMOTE_OBJECT]
            ) {
                profile.oid = this.track(val);
            }
        }

        return profiles;
    }

    expandTransferred(remotePort: MessagePortLike, transferred: any, profile: PseudoTransferProfile): any {

        let instance = transferred;
        if (profile.oid) {
            const oid = profile.oid;
            let msgChannel: MessageChannel | undefined;
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const self = this;
            const mixin: { [k: string]: any; } = {};
            if (profile.oMethods?.length) {
                if (!msgChannel) {
                    msgChannel = new MessageChannel();
                    remotePort.postMessage({
                        type: 'remoteObjectReference',
                        oid,
                        port: msgChannel.port2,
                    }, [msgChannel.port2]);
                }
                for (const x of profile.oMethods) {
                    mixin[x] = function (this: unknown, ...args: any[]) {
                        const { port1: callPort1, port2: callPort2 } = new MessageChannel();
                        const deferred = Defer();
                        const remoteEarlyDisconnectHandler = () => {
                            deferred.reject(new Error('Remote (thread) unexpectedly disconnected'));
                        };
                        msgChannel!.port1.postMessage({
                            type: 'remoteMethodCall',
                            thisArgOid: oid,
                            method: x,
                            args,
                            port: callPort2,
                        }, [callPort2]);
                        callPort1.once('close', remoteEarlyDisconnectHandler);
                        callPort1.once('message', (event) => {
                            callPort1.off('close', remoteEarlyDisconnectHandler);
                            const mapped = self.mangleTransferred(callPort1, event.data, event.dataProfiles || []);
                            callPort1.close();
                            if (event.kind === 'return') {
                                deferred.resolve(mapped);
                                return;
                            }
                            if (event.kind === 'throw') {
                                deferred.reject(mapped);
                                return;
                            }
                            deferred.reject(new Error('Unexpected response'));
                        });

                        return deferred.promise;
                    };
                }
            }
            if (profile.constructorName === 'Function') {
                if (!msgChannel) {
                    msgChannel = new MessageChannel();
                    remotePort.postMessage({
                        type: 'remoteObjectReference',
                        oid,
                        port: msgChannel.port2,
                    }, [msgChannel.port2]);
                }
                instance = function (this: unknown, ...args: any[]) {
                    const { port1: callPort1, port2: callPort2 } = new MessageChannel();
                    const deferred = Defer();
                    msgChannel!.port1.postMessage({
                        type: 'remoteFunctionCall',
                        oid,
                        args,
                        port: callPort2,
                    }, [callPort2]);
                    const remoteEarlyDisconnectHandler = () => {
                        deferred.reject(new Error('Remote (thread) unexpectedly disconnected'));
                    };
                    callPort1.once('close', remoteEarlyDisconnectHandler);
                    callPort1.once('message', (event) => {
                        callPort1.off('close', remoteEarlyDisconnectHandler);
                        const mapped = self.mangleTransferred(callPort1, event.data, event.dataProfiles || []);
                        callPort1.close();
                        if (event.kind === 'return') {
                            deferred.resolve(mapped);
                            return;
                        }
                        if (event.kind === 'throw') {
                            deferred.reject(mapped);
                            return;
                        }
                        deferred.reject(new Error('Unexpected response'));
                    });

                    return deferred.promise;
                };
                Object.assign(instance, transferred);
            } else if (profile.traits.includes('Promise')) {
                if (!msgChannel) {
                    msgChannel = new MessageChannel();
                    remotePort.postMessage({
                        type: 'remoteObjectReference',
                        oid,
                        port: msgChannel.port2,
                    }, [msgChannel.port2]);
                }
                const deferred = Defer();
                const remoteEarlyDisconnectHandler = () => {
                    deferred.reject(new Error('Remote (thread) unexpectedly disconnected'));
                };
                instance = deferred.promise;
                const { port1: callPort1, port2: callPort2 } = new MessageChannel();
                callPort1.once('close', remoteEarlyDisconnectHandler);
                callPort1.once('message', (event) => {
                    callPort1.off('close', remoteEarlyDisconnectHandler);
                    const mapped = this.mangleTransferred(callPort1, event.data, event.dataProfiles || []);
                    callPort1.close();
                    if (event.kind === 'resolved') {
                        deferred.resolve(mapped);
                        return;
                    }
                    if (event.kind === 'rejected') {
                        deferred.reject(mapped);
                        return;
                    }
                    if (event.kind === 'throw') {
                        deferred.reject(mapped);
                        return;
                    }

                    deferred.reject(new Error('Unexpected response'));
                });
                if (profile.traits.length === 1) {
                    callPort1.once('close', () => msgChannel!.port1.close());
                }
                msgChannel.port1.once('close', () => callPort1.close());
                msgChannel.port1.postMessage({
                    type: 'remotePromiseThen',
                    oid,
                    port: callPort2,
                }, [callPort2]);
                Object.assign(instance, transferred);
            } else if (profile.traits.includes('EventEmitter')) {
                if (!msgChannel) {
                    msgChannel = new MessageChannel();
                    remotePort.postMessage({
                        type: 'remoteObjectReference',
                        oid,
                        port: msgChannel.port2,
                    }, [msgChannel.port2]);
                }
                instance = new EventEmitter();
                const { port1: callPort1, port2: callPort2 } = new MessageChannel();

                const remoteEarlyDisconnectHandler = () => {
                    instance.emit('error', new Error('Remote (thread) unexpectedly disconnected'));
                };
                callPort1.once('close', remoteEarlyDisconnectHandler);
                callPort1.on('message', (event) => {
                    callPort1.off('close', remoteEarlyDisconnectHandler);
                    if (event.kind !== 'event') {
                        this.emit('error', event.data || new Error('Unexpected message'));
                    }
                    const mapped = this.mangleTransferred(msgChannel!.port1, event.data, event.dataProfiles || []);
                    instance.emit(event.name, ...(mapped || []));
                });
                msgChannel.port1.once('close', () => callPort1.close());
                msgChannel.port1.postMessage({
                    type: 'remoteEventEmitter',
                    oid: profile.oid,
                    port: callPort2,
                }, [callPort2]);
                Object.assign(instance, transferred);
            }

            if (profile.traits.includes('AsyncIterator')) {
                if (!msgChannel) {
                    msgChannel = new MessageChannel();
                    remotePort.postMessage({
                        type: 'remoteObjectReference',
                        oid,
                        port: msgChannel.port2,
                    }, [msgChannel.port2]);
                }
                instance[Symbol.asyncIterator] = () => {
                    const { port1: callPort1, port2: callPort2 } = new MessageChannel();
                    const deferreds = new Map<number, Deferred<IteratorResult<unknown>>>();
                    const remoteEarlyDisconnectHandler = () => {
                        const err = new Error('Remote (thread) unexpectedly disconnected');
                        for (const d of deferreds.values()) {
                            d.reject(err);
                        }
                    };
                    callPort1.once('close', remoteEarlyDisconnectHandler);
                    let serial = 0;
                    const it = {
                        next: (data: any) => {
                            const n = ++serial;
                            callPort1.postMessage({
                                kind: 'next',
                                data,
                                serial: n,
                            });
                            const d = Defer();
                            deferreds.set(n, d);

                            return d.promise;
                        },
                        return: (data: any) => {
                            const n = ++serial;
                            callPort1.postMessage({
                                kind: 'return',
                                data,
                                serial: n,
                            });
                            const d = Defer();
                            deferreds.set(n, d);

                            return d.promise;
                        },
                        throw: (data: any) => {
                            const n = ++serial;
                            callPort1.postMessage({
                                kind: 'throw',
                                data,
                                serial: n,
                            });
                            const d = Defer();
                            deferreds.set(n, d);

                            return d.promise;
                        },
                        [Symbol.dispose]: function () {
                            callPort1.close();
                            self.portFinalizationRegistry.unregister(this);
                        }
                    };
                    this.portFinalizationRegistry.register(it, callPort1, it);
                    callPort1.on('message', (event) => {
                        if (!event.serial) {
                            return;
                        }
                        const mapped = this.mangleTransferred(callPort1, event.data, event.dataProfiles || []);
                        const d = deferreds.get(event.serial);
                        deferreds.delete(event.serial);
                        if (d) {
                            if (!('value' in mapped && 'done' in mapped)) {
                                d.reject(mapped);
                                callPort1.close();
                                return;
                            }
                            switch (event.kind) {
                                case 'next':
                                    d.resolve(mapped);
                                    break;
                                case 'return':
                                    d.resolve(mapped);
                                    break;
                                case 'throw':
                                    d.resolve(mapped);
                                    break;
                                default: {
                                    d.reject(new Error('Unexpected response'));
                                    callPort1.close();
                                    return;
                                }
                            }
                        }
                        if (mapped.done) {
                            callPort1.off('close', remoteEarlyDisconnectHandler);
                            callPort1.close();
                        }
                    });
                    msgChannel!.port1.postMessage({
                        type: 'remoteAsyncIterator',
                        oid: profile.oid,
                        port: callPort2,
                    }, [callPort2]);

                    return it;
                };
            }

            Object.assign(instance, mixin);

            if (msgChannel) {
                if (instance[Symbol.dispose]) {
                    const origDispose = instance[Symbol.dispose];
                    instance[Symbol.dispose] = function () {
                        msgChannel!.port1.close();
                        self.portFinalizationRegistry.unregister(this);
                        origDispose.apply(this, arguments);
                    };
                } else {
                    instance[Symbol.dispose] = function () {
                        msgChannel!.port1.close();
                        self.portFinalizationRegistry.unregister(this);
                    };
                }
                this.portFinalizationRegistry.register(instance, msgChannel.port1, instance);
            }
        }

        if (profile.constructorName && this.pseudoTransferableTypes.has(profile.constructorName)) {
            const proto = this.pseudoTransferableTypes.get(profile.constructorName)!.prototype;
            const unMarshallFunc = proto?.[SYM_PSEUDO_TRANSFERABLE]?.().unMarshall;
            if (typeof unMarshallFunc === 'function') {
                instance = unMarshallFunc(instance);
            } else if (proto) {
                Object.setPrototypeOf(instance, proto);
            }
        }

        if ((typeof instance === 'object' && instance) || typeof instance === 'function') {
            instance[Symbol.dispose] ??= noop;
        }

        return instance;
    }

    mangleTransferred(remotePort: MessagePortLike, transferred: any, profiles: PseudoTransferProfile[] = []): any {
        if (typeof transferred !== 'object' || !transferred) {
            return transferred;
        }

        const reversed = profiles.reverse();
        for (const profile of reversed) {
            const val = profile.path?.length ? _.get(transferred, profile.path) : transferred;
            if (!val) {
                continue;
            }

            const mapped = this.expandTransferred(remotePort, val, profile);

            if (profile.oid) {
                Reflect.set(mapped, SYM_REMOTE_OBJECT, profile.oid);
            }

            if (!profile.path?.length) {
                transferred = mapped;
                continue;
            }

            _.set(transferred, profile.path, mapped);

            const mode = profile.mode;
            if (mode !== 7) {
                const propName = _.last(profile.path)!;
                const hostPath = profile.path.slice(0, -1);
                const parentObj = hostPath.length ? _.get(transferred, hostPath) : transferred;
                const desc = Object.getOwnPropertyDescriptor(parentObj, propName);
                if (desc) {
                    desc.enumerable = Boolean(mode & 1 << 2);
                    desc.writable = Boolean(mode & 1 << 1);
                    desc.configurable = Boolean(mode & 1);
                    Object.defineProperty(parentObj, propName, desc);
                }
            }

        }

        return transferred;
    }

    handleRemoteAction(refPort: MessagePortLike, val: any) {
        refPort.on('message', (event: PseudoTransferRequest) => {
            const resPort = event.port;
            if (!resPort) {
                return;
            }
            this.openPorts.add(resPort);
            resPort.once('close', () => {
                this.openPorts.delete(resPort);
            });

            switch (event.type) {
                case 'remoteFunctionCall': {
                    try {
                        const result = val.apply(event.thisArg, event.args);
                        this.transferOverTheWire(resPort, {
                            kind: 'return',
                            data: result,
                        });
                    } catch (err) {
                        this.transferOverTheWire(resPort, {
                            kind: 'throw',
                            data: err,
                        });
                    }

                    break;
                }
                case 'remoteMethodCall': {
                    try {
                        const result = Reflect.get(val, event.method!).apply(val, event.args);
                        this.transferOverTheWire(resPort, {
                            kind: 'return',
                            data: result,
                        });
                    } catch (err) {
                        this.transferOverTheWire(resPort, {
                            kind: 'throw',
                            data: err,
                        });
                    }

                    break;
                }
                case 'remotePromiseThen': {
                    try {

                        val.then(
                            (data: any) => {
                                this.transferOverTheWire(resPort, {
                                    kind: 'resolved',
                                    data,
                                });
                            },
                            (err: any) => {
                                this.transferOverTheWire(resPort, {
                                    kind: 'rejected',
                                    data: err,
                                });
                            }
                        );
                    } catch (err) {
                        this.transferOverTheWire(resPort, {
                            kind: 'throw',
                            data: err,
                        });
                    }
                    break;
                }
                case 'remoteEventEmitter': {
                    const originalEmit = val.emit;
                    val.emit = (function (this: unknown, name: string, ...args: any[]) {
                        resPort.postMessage({
                            kind: 'event',
                            name,
                            data: args,
                        });
                        return originalEmit.call(this, name, ...args);
                    }).bind(val);

                    break;
                }
                case 'remoteAsyncIterator': {
                    const it = val[Symbol.asyncIterator]();
                    resPort.on('message', async (event: PseudoTransferEvent) => {
                        try {
                            switch (event.kind) {
                                case 'next': {
                                    this.transferOverTheWire(resPort, {
                                        kind: 'next',
                                        data: await it.next(event.data),
                                        serial: event.serial,
                                    });
                                    break;
                                }
                                case 'return': {
                                    this.transferOverTheWire(resPort, {
                                        kind: 'return',
                                        data: await it.return(event.data),
                                        serial: event.serial,
                                    });
                                    break;
                                }
                                case 'throw': {
                                    this.transferOverTheWire(resPort, {
                                        kind: 'throw',
                                        data: await it.throw(event.data),
                                        serial: event.serial,
                                    });
                                    break;
                                }
                            }
                        } catch (err) {
                            this.transferOverTheWire(resPort, {
                                kind: 'throw',
                                data: err,
                                serial: event.serial,
                            });
                        }
                    });

                    break;
                }

            }
        });
        this.openPorts.add(refPort);
        refPort.once('close', () => {
            this.openPorts.delete(refPort);
        });
    }

    isNativelyTransferable(thing: any) {
        if (typeof thing === 'function') {
            return false;
        }

        if (thing instanceof Promise) {
            return false;
        }

        if (thing instanceof ReadableStream) {
            return true;
        }

        if (thing instanceof MessagePort) {
            return true;
        }

        if (isTypedArray(thing) && !Buffer.isBuffer(thing)) {
            return true;
        }

        if (typeof thing === 'object' && thing !== null && thing[SYM_PSEUDO_TRANSFERABLE]) {
            return false;
        }

        return undefined;
    }

    protected customDeepClone(obj: any) {
        return ['object', 'function'].includes(typeof obj) ? deepCloneAndExpose(obj, (v) => {
            const thisType = typeof v;
            if (this.isNativelyTransferable(v) !== undefined && thisType !== 'function') {
                return v;
            }
            const pseudoTransferableOptions = v?.[SYM_PSEUDO_TRANSFERABLE]?.();
            if (pseudoTransferableOptions?.marshall) {
                return v;
            }
            if (thisType === 'function') {
                return undefined;
            }
            if (isPrimitiveLike(v)) {
                return v;
            }

        }) : obj;
    }

    composeTransferable(obj: any) {
        const o = {
            data: this.customDeepClone(obj),
        };

        const r = this.prepareForTransfer(obj);
        const oidObjMap = new Map();
        const transferList = [];
        const profiles = [];
        for (const [v, p] of r) {
            const equv = this.customDeepClone(v);
            _.set(o, ['data', ...(p.path || [])], equv);

            if (p.oid) {
                oidObjMap.set(p.oid, v);
            }

            const nativelyTransferable = this.isNativelyTransferable(equv);
            if (nativelyTransferable) {
                transferList.push(equv);
                continue;
            }

            profiles.push(p);
            if (nativelyTransferable === false) {
                const pseudoTransferableOptions = v[SYM_PSEUDO_TRANSFERABLE]?.();
                if (typeof pseudoTransferableOptions?.marshall === 'function') {
                    _.set(o, ['data', ...(p.path || [])], pseudoTransferableOptions.marshall(equv));
                } else if (equv && isPrimitiveLike(equv)) {
                    _.set(o, ['data', ...(p.path || [])], { ...equv });
                }
            }
        }

        return {
            data: o.data,
            transferList,
            profiles,
            oidObjMap,
        };
    }

    transferOverTheWire(port: MessagePortLike, event: PseudoTransferEvent) {
        const { data, transferList, profiles, oidObjMap } = this.composeTransferable(event.data);

        event.data = data;
        event.dataProfiles = profiles;

        port.on('message', (trackEvent: PseudoTransferRequest) => {
            if (trackEvent.type !== 'remoteObjectReference') {
                return;
            }

            const obj = oidObjMap.get(trackEvent.oid);
            const port = trackEvent.port;
            if (!(obj && port)) {
                return;
            }

            this.handleRemoteAction(port, obj);
        });

        try {
            port.postMessage(event, transferList);
        } catch (err: any) {
            port.postMessage({
                kind: 'throw',
                data: marshalErrorLike(err),
            });
        }
    }

}

function getConfigMode(d: PropertyDescriptor) {
    return ((d.enumerable ? 1 << 2 : 0) | (d.writable ? 1 << 1 : 0) | (d.configurable ? 1 : 0)) as TransferMode;
}

export function* deepVectorizeForTransfer(
    obj: any,
    stack: string[] = [],
    refStack: WeakSet<any> = new WeakSet(),
    parentTraits?: SpecialTraits[] | null
): Iterable<[string[], any, TransferMode, SpecialTraits[] | null, string[] | undefined]> {
    if (!(obj && typeof obj.hasOwnProperty === 'function')) {
        return;
    }

    const transferSettings: PseudoTransferableOptions | undefined = obj?.[SYM_PSEUDO_TRANSFERABLE]?.();

    if (Array.isArray(transferSettings?.imitateMethods)) {
        if (transferSettings!.imitateMethods.length && parentTraits) {
            if (!parentTraits.includes('thisArg')) {
                parentTraits.push('thisArg');
            }
        }
    }

    if (transferSettings?.copyOwnProperty === 'none') {
        return;
    }

    if (isPrimitiveLike(obj)) {
        return;
    }

    const propertyDescriptors = Object.getOwnPropertyDescriptors(obj);

    for (const [name, descriptor] of Object.entries(propertyDescriptors)) {
        if (typeof name !== 'string') {
            continue;
        }
        if (transferSettings?.ignoreOwnProperty?.includes(name)) {
            continue;
        }
        if ((transferSettings?.copyOwnProperty === 'enumerable') && !descriptor.enumerable) {
            continue;
        } else if (Array.isArray(transferSettings?.copyOwnProperty) && !transferSettings!.copyOwnProperty.includes(name)) {
            continue;
        }
        let val;
        try {
            val = Reflect.get(obj, name);
        } catch (err) {
            // Maybe some kind of getter and it throws.
            val = null;
        }

        const valTransferSettings: PseudoTransferableOptions | undefined = val?.[SYM_PSEUDO_TRANSFERABLE]?.();
        const valTraits = valTransferSettings?.imitateSpecialTraits || detectSpecialTraits(val);

        if (refStack.has(val) || val?.[SYM_REMOTE_OBJECT]) {
            // Circular
            yield [stack.concat(name), val, getConfigMode(descriptor as PropertyDescriptor), null, undefined];

            continue;
        }

        if (isPrimitiveLike(val) && typeof val !== 'function' && !descriptor.enumerable) {
            yield [stack.concat(name), val, getConfigMode(descriptor as PropertyDescriptor), valTraits, valTransferSettings?.imitateMethods];

            continue;
        }

        if (typeof val === 'function' || typeof val === 'object' && val !== null) {
            refStack.add(val);
        }
        if (typeof val === 'function') {
            if (parentTraits && !parentTraits.includes('thisArg')) {
                parentTraits.push('thisArg');
            }
        }
        if (val !== null && typeof val === 'object' || typeof val === 'function') {
            if ((!_.isPlainObject(val) && !_.isArray(val) && !_.isArguments(val)) || valTransferSettings?.imitateSpecialTraits) {
                yield [stack.concat(name), val, getConfigMode(descriptor as PropertyDescriptor), valTraits, valTransferSettings?.imitateMethods];
            }

            yield* deepVectorizeForTransfer(val, stack.concat(name), refStack, valTraits);
        }
    }

    return;
}

