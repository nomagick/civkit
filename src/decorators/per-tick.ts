let i = 1;

const tickFunction = process?.nextTick || setImmediate || setTimeout;

export function perTick() {
    return function perTickDecorator(_target: any, _propName: string | symbol, propDesc: PropertyDescriptor) {
        const perTickSymbol = Symbol(`PER_TICK:${i++}`);
        const func: Function = propDesc.value;

        if (typeof func !== 'function') {
            throw new Error('Invalid use of perTick decorator');
        }

        function newFunc(this: any, ...argv: any[]) {
            if (!this[perTickSymbol]) {
                this[perTickSymbol] = {
                    tickActive: false,
                    lastThrown: perTickSymbol
                };
            }
            const conf = this[perTickSymbol];
            if (conf.tickActive) {
                if (conf.lastThrown !== perTickSymbol) {
                    throw conf.lastThrown;
                }

                return conf.lastResult;
            }

            conf.tickActive = true;
            conf.lastThrown = perTickSymbol;
            conf.lastResult = undefined;
            tickFunction(() => (conf.tickActive = false));
            try {
                conf.lastResult = func.apply(this, argv);

                return conf.lastResult;
            } catch (err) {
                conf.lastThrown = err;
                throw err;
            }
        }

        Object.defineProperty(newFunc, 'name',
            { value: `perTickDecorated${(func.name[0] || '').toUpperCase()}${func.name.slice(1)}`, writable: false, enumerable: false, configurable: true }
        );

        propDesc.value = newFunc;

        return propDesc;
    };
}

let j = 1;
export function perNextTick() {
    const perNextTickSymbol = Symbol(`PER_NEXT_TICK:${j++}`);

    return function perNextTickDecorator(_target: any, _propName: string | symbol, propDesc: PropertyDescriptor) {
        const func: Function = propDesc.value;

        if (typeof func !== 'function') {
            throw new Error('Invalid use of perNextTick decorator');
        }

        function newFunc(this: any, ...argv: any[]) {
            if (!this[perNextTickSymbol]) {
                this[perNextTickSymbol] = {
                    tickActive: false,
                };
            }
            const conf = this[perNextTickSymbol];
            if (conf.tickActive) {
                return;
            }

            conf.tickActive = true;
            tickFunction(() => {
                conf.tickActive = false;

                try {
                    func.apply(this, argv);
                } catch (err) {
                    throw err;
                }
            });
        }

        propDesc.value = newFunc;

        Object.defineProperty(newFunc, 'name',
            { value: `perNextTickDecorated${(func.name[0] || '').toUpperCase()}${func.name.slice(1)}`, writable: false, enumerable: false, configurable: true }
        );

        return propDesc;
    };
}
