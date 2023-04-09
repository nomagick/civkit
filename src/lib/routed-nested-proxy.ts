import _, { isArray, isPlainObject } from 'lodash';
import { EventEmitter } from 'events';
import { isPrimitiveLike } from '../utils';

const nextTickFunc = process?.nextTick || setImmediate || setTimeout;

function safeGet(obj: any, key: string | number | symbol, recv?: any) {
    try {
        return Reflect.get(obj, key, recv || obj);
    } catch (err) {
        return null;
    }
}

export interface RoutedProxyHandler<T extends object> {
    getPrototypeOf?(target: T, routes: string[]): object | null;
    setPrototypeOf?(target: T, v: any, routes: string[]): boolean;
    isExtensible?(target: T, routes: string[]): boolean;
    preventExtensions?(target: T, routes: string[]): boolean;
    getOwnPropertyDescriptor?(target: T, p: PropertyKey, routes: string[]): PropertyDescriptor | undefined;
    has?(target: T, p: PropertyKey, routes: string[]): boolean;
    get?(target: T, p: PropertyKey, receiver: any, routes: string[]): any;
    set?(target: T, p: PropertyKey, value: any, receiver: any, routes: string[]): boolean | undefined;
    deleteProperty?(target: T, p: PropertyKey, routes: string[]): boolean | undefined;
    defineProperty?(target: T, p: PropertyKey, attributes: PropertyDescriptor, routes: string[]): boolean;
    enumerate?(target: T, routes: string[]): PropertyKey[];
    ownKeys?(target: T, routes: string[]): PropertyKey[];
    apply?(target: T, thisArg: any, argArray?: any, routes?: string[]): any;
    construct?(target: T, argArray: any, newTarget?: any, routes?: string[]): object;
}


export interface UpdateEvent<T = any, P = any> {
    routes: string[];
    key: string;
    target: T;
    targetProxy?: T;
    newVal: P;
    newValProxy?: P;
    oldVal: P;
    oldValProxy?: P;
}

export interface DropEvent<T = any, P = any> {
    routes: string[];
    key: string;
    target: T;
    targetProxy?: T;
    oldVal: P;
    oldValProxy?: P;
}

export interface AttachEvent<T = any> {
    routes: string[];
    target: T;
    targetProxy?: T;
}

export interface DetachEvent<T = any> {
    routes: string[];
    target: T;
    targetProxy?: T;
}

export interface ProxyEventEmitter<T> extends EventEmitter {
    on(event: 'attached', listener: (event: AttachEvent<T>) => any): this;
    on(event: 'detached', listener: (event: DetachEvent<T>) => any): this;
    on(event: 'update', listener: (event: UpdateEvent<T>) => any): this;
    on(event: 'drop', listener: (event: DropEvent<T>) => any): this;
}

function isObject(obj: any) {
    if ((typeof obj) === 'object' && obj !== null) {
        return true;
    }
    // if ((typeof obj) === 'function') {
    //     return true;
    // }

    return false;
}

export function isPositiveInt(dig: any) {
    return Math.abs(parseInt(dig)).toString() === dig.toString();
}

export function routeJoin(tgt: any, path: string, key: string) {
    return (Array.isArray(tgt) && isPositiveInt(key)) ?
        `${path}[${key as string}]` : `${path ? path + '.' : ''}${key as string}`;
}

export function routedNestedProxy<T extends { [k: string]: any }>(
    target: T, handlers: RoutedProxyHandler<T>, deproxySymbol: symbol = Symbol('Default RoutedNestedProxy Deproxy Symbol')
) {
    const proxyMap = new WeakMap<object, any>();
    const routeTrack = new WeakMap<Object, Set<string>>();

    const emitter = new EventEmitter() as ProxyEventEmitter<T>;

    const modifiedHandlers: ProxyHandler<T> = {};

    let detachAttach: boolean = false;
    const tickDetached = new Set<T>();
    const tickAttached = new Set<T>();

    function detachAttachRoutine() {
        if (detachAttach) {
            return;
        }

        detachAttach = true;

        nextTickFunc(() => {
            detachAttach = false;
            const actuallyAttached = new Set<T>();
            const actuallyDetached = new Set<T>(tickDetached);
            for (const x of tickAttached.values()) {
                if (tickDetached.has(x)) {
                    actuallyDetached.delete(x);

                    continue;
                }
                actuallyAttached.add(x);
            }


            tickAttached.clear();
            tickDetached.clear();

            for (const x of actuallyAttached) {
                if (!routeTrack.has(x)) {
                    continue;
                }
                emitter.emit('attached', {
                    routes: Array.from(routeTrack.get(x)!),
                    target: x,
                    targetProxy: proxyMap.get(x)
                });
            }

            for (const x of actuallyDetached) {
                if (!routeTrack.has(x)) {
                    continue;
                }
                emitter.emit('detached', {
                    routes: Array.from(routeTrack.get(x)!),
                    target: x,
                    targetProxy: proxyMap.get(x)
                });
            }
        });
    }

    function deproxy(obj: any): any {
        if (!isObject(obj)) {
            return obj;
        }
        const x = obj[deproxySymbol];
        if (x) {
            return deproxy(x);
        }

        return obj;
    }

    const bareRoot = deproxy(target);

    function clearRoute(bareTgt: any, routeToClear: string) {
        const routeSet = routeTrack.get(bareTgt);
        if (!routeSet) {
            return;
        }

        for (const route of routeSet.values()) {
            if (route.startsWith(routeToClear)) {
                routeSet.delete(route);
                const o = _.get(bareRoot, route);
                if (o) {
                    clearRoute(o, route);
                }
            }
        }
        if (routeSet.size === 0) {
            tickDetached.add(bareTgt);
            detachAttachRoutine();
        }
    }

    function setRoute(bareTgt: any, routeToSet: string, recever?: any) {
        const routeSet = routeTrack.get(bareTgt);
        if (!routeSet) {
            return;
        }

        routeSet.add(routeToSet);
        if (routeSet.size === 1) {
            tickAttached.add(bareTgt);
            detachAttachRoutine();
        }

        for (const key of Object.getOwnPropertyNames(bareTgt)) {
            const val = safeGet(bareTgt, key, recever);
            if (isObject(val)) {
                const trackRoute = routeJoin(bareTgt, routeToSet, key);
                setRoute(val, trackRoute, recever);
            }
        }
    }

    function getRoutes(tgt: object) {
        const bareObj = deproxy(tgt);
        const routeSet = routeTrack.get(bareObj);
        if (!routeSet) {
            throw new TypeError('Unable to find route set for active target');
            // return null;
        }
        const activeRoutes: string[] = [];
        const deadRoutes: string[] = [];
        for (const route of routeSet.values()) {
            if (route === '' && target === bareObj) {
                activeRoutes.push(route);
                continue;
            }
            if (_.get(target, route) === bareObj) {
                activeRoutes.push(route);
                continue;
            }
            deadRoutes.push(route);
        }
        for (const x of deadRoutes) {
            clearRoute(tgt, x);
        }
        // if (!activeRoutes.length) {
        //     throw new TypeError('Unable to find valid route for active target');
        // }

        return activeRoutes;
    }

    modifiedHandlers.get = (tgt: any, key, _receiver) => {
        const bareTgt = deproxy(tgt);
        const routes = getRoutes(tgt);
        if (handlers.get && routes.length) {
            const result = handlers.get(tgt, key, _receiver, routes);
            if (result !== undefined && result !== null) {
                return result;
            }
        }
        // if (key === 'WHOIAM') {
        //     return deproxySymbol.toString();
        // }
        if (key === deproxySymbol) {
            return bareTgt;
        }

        if (!Object.hasOwnProperty.call(bareTgt, key)) {
            return safeGet(bareTgt, key, _receiver);
        }

        const orig = safeGet(bareTgt, key, _receiver);
        if (typeof key === 'symbol') {
            return orig;
        }
        // const propDesc = Object.getOwnPropertyDescriptor(bareTgt, key);

        if (isPrimitiveLike(orig)) {
            return orig;
        }

        const bareObj = deproxy(orig);
        const refProxy = proxyMap.get(bareObj);
        if (refProxy) {
            return refProxy;
        }

        if (isPlainObject(bareObj) || isArray(bareObj) && (typeof key === 'string') && routes.length) {
            const proxy = wrap(bareObj, bareTgt, key as string, _receiver);

            return proxy;
        }

        return orig;
    };

    modifiedHandlers.set = (tgt: any, key, val, _receiver) => {
        const bareTgt = deproxy(tgt);
        const orig = safeGet(bareTgt, key, _receiver);
        const routes = getRoutes(bareTgt);
        const bareVal = deproxy(val);
        // console.log(tgt, key, val, route);
        if (handlers.set && routes.length) {
            const result = handlers.set(bareTgt, key, bareVal, _receiver, routes);
            if (result === false) {
                return result;
            }
            if (result === undefined) {
                if (typeof key === 'symbol') {
                    bareTgt[key] = val;

                    return true;
                }

                bareTgt[key] = val;
            }
            if (result === true && deproxy(safeGet(bareTgt, key, _receiver)) === orig) {
                return true;
            }
        } else {
            bareTgt[key] = val;
        }
        if ((isPlainObject(bareVal) || isArray(bareVal)) && (typeof key === 'string') && routes.length) {
            if (orig === bareVal) {
                return true;
            }

            if (proxyMap.has(orig)) {
                const trackRoutes = routes.map((route) => routeJoin(bareTgt, route, key));

                for (const r of trackRoutes) {
                    clearRoute(orig, r);
                }
            }

            wrap(bareVal, bareTgt, key);

            emitter.emit('update', {
                routes: Array.from(routes),
                key,
                target: bareTgt,
                targetProxy: proxyMap.get(bareTgt),
                newVal: bareVal,
                newProxy: proxyMap.get(bareVal),
                oldVal: orig,
                oldProxy: proxyMap.get(orig)
            });

            return true;
        }

        emitter.emit('update', {
            routes: Array.from(routes),
            key,
            target: bareTgt,
            targetProxy: proxyMap.get(bareTgt),
            newVal: bareVal,
            newProxy: proxyMap.get(bareVal),
            oldVal: orig,
            oldProxy: proxyMap.get(orig)
        });

        return true;
    };

    modifiedHandlers.deleteProperty = (tgt: any, key) => {

        const bareTgt = deproxy(tgt);

        let pointless = false;
        if (!Object.hasOwnProperty.call(bareTgt, key)) {
            pointless = true;
        }

        const orig = safeGet(bareTgt, key);
        const routes = getRoutes(bareTgt);
        // console.log(tgt, key, val, route);
        if (handlers.deleteProperty && routes.length) {
            const result = handlers.deleteProperty(bareTgt, key, routes);
            if (result === false) {
                return result;
            }
            if (result === undefined) {
                if (typeof key === 'symbol') {
                    // tslint:disable-next-line: no-dynamic-delete
                    delete bareTgt[key];

                    return true;
                }

                // tslint:disable-next-line: no-dynamic-delete
                delete bareTgt[key];
            }
            if (result === true && deproxy(safeGet(bareTgt, key)) === orig) {
                return true;
            }
        } else {
            // tslint:disable-next-line: no-dynamic-delete
            delete bareTgt[key];
        }

        if (pointless) {
            return true;
        }

        if ((typeof key === 'string') && routes.length) {
            const trackRoutes = routes.map((route) => routeJoin(bareTgt, route, key));

            for (const r of trackRoutes) {
                clearRoute(orig, r);
            }

            emitter.emit('drop', {
                routes: Array.from(routes),
                key,
                target: bareTgt,
                targetProxy: proxyMap.get(bareTgt),
                oldVal: orig,
                oldProxy: proxyMap.get(orig)
            });

            return true;
        }

        emitter.emit('drop', {
            routes: Array.from(routes),
            key,
            target: bareTgt,
            targetProxy: proxyMap.get(bareTgt),
            oldVal: orig,
            oldProxy: proxyMap.get(orig)
        });

        return true;
    };

    for (const x in handlers) {
        if (x !== 'get' && x !== 'set' && x !== 'deleteProperty') {
            (modifiedHandlers as any)[x] = function (...argv: any[]) {
                const route = getRoutes(argv[0]);

                return (handlers as any)[x].call(this, ...argv, route);
            };
        }
    }

    function wrap(bareObj: object, bareParent?: object, wrapKey: string = '', recever?: any) {
        const parentRouteSet = bareParent ? routeTrack.get(bareParent) : new Set<string>(['']);
        if (!parentRouteSet) {
            throw new Error('Unable to find routeSet for parentObj');
        }
        const parentRoutes = Array.from(parentRouteSet);

        const newRoutes = parentRoutes.map((route) => routeJoin(bareParent, route, wrapKey));

        if (proxyMap.has(bareObj)) {
            const routeSet = routeTrack.get(bareObj);
            if (routeSet) {
                for (const route of newRoutes) {
                    routeSet.add(route);
                }
            } else {
                routeTrack.set(bareObj, new Set(newRoutes));
            }

            for (const route of newRoutes) {
                setRoute(bareObj, route, recever);
            }

            return proxyMap.get(bareObj);
        }
        const proxy = new Proxy(bareObj, modifiedHandlers);

        proxyMap.set(bareObj, proxy);
        routeTrack.set(bareObj, new Set(newRoutes));

        for (const key of Object.getOwnPropertyNames(bareObj)) {
            const val = safeGet(bareObj, key, recever);
            const bareVal = deproxy(val);

            if (isPlainObject(bareVal) || Array.isArray(bareVal)) {
                const trackRoutes = newRoutes.map((route) => routeJoin(bareObj, route, key));

                if (!proxyMap.has(bareVal)) {
                    wrap(bareVal, bareObj, key, recever);
                } else {
                    const routeSet = routeTrack.get(bareVal);
                    if (routeSet) {
                        for (const trackRoute of trackRoutes) {
                            routeSet.add(trackRoute);
                        }
                    } else {
                        routeTrack.set(bareVal, new Set(trackRoutes));
                    }
                }
            }
        }

        return proxy;
    }


    if (!isObject(bareRoot)) {
        throw new Error('Only object could be proxied');
    }

    const rootProxy = wrap(bareRoot);

    return { proxy: rootProxy, proxyMap, getRoutes, routeTrack, emitter, deproxy };
}

export default routedNestedProxy;
