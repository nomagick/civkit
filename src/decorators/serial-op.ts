import { Defer } from '../lib/defer';

const NOOP = () => undefined;

const DEFAULT_SERIAL_SYMBOL = Symbol('SERIAL_OP');

export function serialOperation(id: symbol = DEFAULT_SERIAL_SYMBOL) {
    return function serialOperationDecorator(_target: any, _propName: string | symbol, propDesc: PropertyDescriptor) {
        const func: Function = propDesc.value;

        if (typeof func !== 'function' || typeof id !== 'symbol') {
            throw new Error('Invalid use of serial operation decorator');
        }

        async function serialOperationAwareFunction(this: any, ...argv: any[]) {
            const lastPromise = this[id] as Promise<unknown> | undefined;

            const deferred = Defer<unknown>();

            this[id] = deferred.promise;
            await lastPromise?.then(NOOP, NOOP);

            let result: unknown;
            try {
                result = await func.apply(this, argv);

                deferred.resolve(result);
            } catch (err) {
                deferred.reject(err);
            }

            return deferred.promise;
        }

        Object.defineProperty(serialOperationAwareFunction, 'name',
            { value: `serialOperationDecorated${(func.name[0] || '').toUpperCase()}${func.name.slice(1)}`, writable: false, enumerable: false, configurable: true }
        );

        propDesc.value = serialOperationAwareFunction;

        return propDesc;
    };
}

const collector: any = {};
export function globalSerialOperation(id: symbol = DEFAULT_SERIAL_SYMBOL) {
    return function serialOperationDecorator(_target: any, _propName: string | symbol, propDesc: PropertyDescriptor) {
        const func: Function = propDesc.value;

        if (typeof func !== 'function' || typeof id !== 'symbol') {
            throw new Error('Invalid use of global serial operation decorator');
        }

        async function serialOperationAwareFunction(this: any, ...argv: any[]) {
            const lastPromise = collector[id] as Promise<unknown> | undefined;

            const deferred = Defer<unknown>();

            collector[id] = deferred.promise;
            await lastPromise?.then(NOOP, NOOP);

            let result: unknown;
            try {
                result = await func.apply(this, argv);

                deferred.resolve(result);
            } catch (err) {
                deferred.reject(err);
            }

            return deferred.promise;
        }

        Object.defineProperty(serialOperationAwareFunction, 'name',
            { value: `globalSerialOperationDecorated${(func.name[0] || '').toUpperCase()}${func.name.slice(1)}`, writable: false, enumerable: false, configurable: true }
        );

        propDesc.value = serialOperationAwareFunction;

        return propDesc;
    };
}
