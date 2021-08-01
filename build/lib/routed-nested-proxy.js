"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routedNestedProxy = exports.routeJoin = exports.isPositiveInt = exports.isNative = void 0;
const tslib_1 = require("tslib");
const lodash_1 = tslib_1.__importStar(require("lodash"));
const events_1 = require("events");
function isNative(obj) {
    if (typeof obj !== 'object') {
        return false;
    }
    if (obj instanceof Promise) {
        return true;
    }
    if (obj instanceof Date) {
        return true;
    }
    if (obj instanceof RegExp) {
        return true;
    }
    if (obj instanceof Map) {
        return true;
    }
    if (obj instanceof Set) {
        return true;
    }
    return false;
}
exports.isNative = isNative;
const nextTickFunc = process?.nextTick || setImmediate || setTimeout;
function safeGet(obj, key, recv) {
    try {
        return Reflect.get(obj, key, recv || obj);
    }
    catch (err) {
        return null;
    }
}
function isObject(obj) {
    if ((typeof obj) === 'object' && obj !== null) {
        return true;
    }
    return false;
}
function isPositiveInt(dig) {
    return Math.abs(parseInt(dig)).toString() === dig.toString();
}
exports.isPositiveInt = isPositiveInt;
function routeJoin(tgt, path, key) {
    return (Array.isArray(tgt) && isPositiveInt(key)) ?
        `${path}[${key}]` : `${path ? path + '.' : ''}${key}`;
}
exports.routeJoin = routeJoin;
function routedNestedProxy(target, handlers, deproxySymbol = Symbol('Default RoutedNestedProxy Deproxy Symbol')) {
    const proxyMap = new WeakMap();
    const routeTrack = new WeakMap();
    const emitter = new events_1.EventEmitter();
    const modifiedHandlers = {};
    let detachAttach = false;
    const tickdetached = new Set();
    const tickAttached = new Set();
    function detachAttachRoutine() {
        if (detachAttach) {
            return;
        }
        detachAttach = true;
        nextTickFunc(() => {
            detachAttach = false;
            const actuallyAttached = new Set();
            const actuallydetached = new Set(tickdetached);
            for (const x of tickAttached.values()) {
                if (tickdetached.has(x)) {
                    actuallydetached.delete(x);
                    continue;
                }
                actuallyAttached.add(x);
            }
            tickAttached.clear();
            tickdetached.clear();
            for (const x of actuallyAttached) {
                if (!routeTrack.has(x)) {
                    continue;
                }
                emitter.emit('attached', {
                    routes: Array.from(routeTrack.get(x)),
                    target: x,
                    targetProxy: proxyMap.get(x)
                });
            }
            for (const x of actuallydetached) {
                if (!routeTrack.has(x)) {
                    continue;
                }
                emitter.emit('detached', {
                    routes: Array.from(routeTrack.get(x)),
                    target: x,
                    targetProxy: proxyMap.get(x)
                });
            }
        });
    }
    function deproxy(obj) {
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
    function clearRoute(bareTgt, routeToClear) {
        const routeSet = routeTrack.get(bareTgt);
        if (!routeSet) {
            return;
        }
        for (const route of routeSet.values()) {
            if (route.startsWith(routeToClear)) {
                routeSet.delete(route);
                const o = lodash_1.default.get(bareRoot, route);
                if (o) {
                    clearRoute(o, route);
                }
            }
        }
        if (routeSet.size === 0) {
            tickdetached.add(bareTgt);
            detachAttachRoutine();
        }
    }
    function setRoute(bareTgt, routeToSet, recever) {
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
    function getRoutes(tgt) {
        const bareObj = deproxy(tgt);
        const routeSet = routeTrack.get(bareObj);
        if (!routeSet) {
            throw new TypeError('Unable to find route set for active target');
        }
        const activeRoutes = [];
        const deadRoutes = [];
        for (const route of routeSet.values()) {
            if (route === '' && target === bareObj) {
                activeRoutes.push(route);
                continue;
            }
            if (lodash_1.default.get(target, route) === bareObj) {
                activeRoutes.push(route);
                continue;
            }
            deadRoutes.push(route);
        }
        for (const x of deadRoutes) {
            clearRoute(tgt, x);
        }
        return activeRoutes;
    }
    modifiedHandlers.get = (tgt, key, _receiver) => {
        const bareTgt = deproxy(tgt);
        const routes = getRoutes(tgt);
        if (handlers.get && routes.length) {
            const result = handlers.get(tgt, key, _receiver, routes);
            if (result !== undefined && result !== null) {
                return result;
            }
        }
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
        if (isNative(orig)) {
            return orig;
        }
        const bareObj = deproxy(orig);
        const refProxy = proxyMap.get(bareObj);
        if (refProxy) {
            return refProxy;
        }
        if (lodash_1.isPlainObject(bareObj) || lodash_1.isArray(bareObj) && (typeof key === 'string') && routes.length) {
            const proxy = wrap(bareObj, bareTgt, key, _receiver);
            return proxy;
        }
        return orig;
    };
    modifiedHandlers.set = (tgt, key, val, _receiver) => {
        const bareTgt = deproxy(tgt);
        const orig = safeGet(bareTgt, key, _receiver);
        const routes = getRoutes(bareTgt);
        const bareVal = deproxy(val);
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
        }
        else {
            bareTgt[key] = val;
        }
        if ((lodash_1.isPlainObject(bareVal) || lodash_1.isArray(bareVal)) && (typeof key === 'string') && routes.length) {
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
    modifiedHandlers.deleteProperty = (tgt, key) => {
        const bareTgt = deproxy(tgt);
        let pointless = false;
        if (!Object.hasOwnProperty.call(bareTgt, key)) {
            pointless = true;
        }
        const orig = safeGet(bareTgt, key);
        const routes = getRoutes(bareTgt);
        if (handlers.deleteProperty && routes.length) {
            const result = handlers.deleteProperty(bareTgt, key, routes);
            if (result === false) {
                return result;
            }
            if (result === undefined) {
                if (typeof key === 'symbol') {
                    delete bareTgt[key];
                    return true;
                }
                delete bareTgt[key];
            }
            if (result === true && deproxy(safeGet(bareTgt, key)) === orig) {
                return true;
            }
        }
        else {
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
            modifiedHandlers[x] = function (...argv) {
                const route = getRoutes(argv[0]);
                return handlers[x].call(this, ...argv, route);
            };
        }
    }
    function wrap(bareObj, bareParent, wrapKey = '', recever) {
        const parentRouteSet = bareParent ? routeTrack.get(bareParent) : new Set(['']);
        if (!parentRouteSet) {
            throw new Error('Unable to finde routeset for parentObj');
        }
        const parentRoutes = Array.from(parentRouteSet);
        const newRoutes = parentRoutes.map((route) => routeJoin(bareParent, route, wrapKey));
        if (proxyMap.has(bareObj)) {
            const routeSet = routeTrack.get(bareObj);
            if (routeSet) {
                for (const route of newRoutes) {
                    routeSet.add(route);
                }
            }
            else {
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
            if (lodash_1.isPlainObject(bareVal) || Array.isArray(bareVal)) {
                const trackRoutes = newRoutes.map((route) => routeJoin(bareObj, route, key));
                if (!proxyMap.has(bareVal)) {
                    wrap(bareVal, bareObj, key, recever);
                }
                else {
                    const routeSet = routeTrack.get(bareVal);
                    if (routeSet) {
                        for (const trackRoute of trackRoutes) {
                            routeSet.add(trackRoute);
                        }
                    }
                    else {
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
exports.routedNestedProxy = routedNestedProxy;
exports.default = routedNestedProxy;
//# sourceMappingURL=routed-nested-proxy.js.map