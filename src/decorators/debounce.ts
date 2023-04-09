import { Defer, Deferred } from '../lib/defer';

let i = 1;

interface DebounceConf {
    initAt?: number;
    timer?: NodeJS.Timeout;
    deferred?: Deferred<any>;
}

function resetTimer(this: any, conf: DebounceConf, func: Function, argv: any, waitMs: number) {
    if (conf.timer) {
        clearTimeout(conf.timer);
    }
    conf.timer = setTimeout(() => {
        conf.initAt = undefined;
        conf.timer = undefined;
        if (!conf.deferred) {
            return;
        }
        const deferred = conf.deferred!;
        conf.deferred = undefined;
        try {
            const r = func.apply(this, argv);
            deferred.resolve(r);

            return r;
        } catch (err) {
            deferred.reject(err);
        }
    }, waitMs);
}

export function debounce(waitMs: number = 1000, maxWait: number = Infinity) {
    return function debounceDecorator(_target: any, _propName: string | symbol, propDesc: PropertyDescriptor) {
        const debounceSymbol = Symbol(`DEBOUNCE:${i++}`);
        const func: Function = propDesc.value;

        if (typeof func !== 'function') {
            throw new Error('Invalid use of debounce decorator');
        }

        function newFunc(this: any, ...argv: any[]) {
            if (!this[debounceSymbol]) {
                this[debounceSymbol] = {
                    initAt: undefined,
                    timer: undefined,
                    deferred: undefined,
                } as DebounceConf;
            }
            const conf: DebounceConf = this[debounceSymbol];
            if (conf.timer && conf.deferred && conf.initAt && (Date.now() - conf.initAt <= maxWait)) {
                resetTimer.call(this, conf, func, argv, waitMs);

                return conf.deferred.promise;
            }

            conf.deferred = Defer();
            conf.initAt = Date.now();
            resetTimer.call(this, conf, func, argv, waitMs);

            return conf.deferred.promise;
        }

        Object.defineProperty(newFunc, 'name',
            { value: `debounceDecorated${(func.name[0] || '').toUpperCase()}${func.name.slice(1)}`, writable: false, enumerable: false, configurable: true }
        );

        propDesc.value = newFunc;

        return propDesc;
    };
}
