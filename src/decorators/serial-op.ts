import { Defer } from "../lib/defer";
const NOOP = () => undefined;
export function serialOperation(id: symbol) {

    return function serialOperationDecorator(_target: any, _propName: string | symbol, propDesc: PropertyDescriptor) {

        const func: Function = propDesc.value;

        if (typeof func !== 'function') {
            throw new Error('Invalid use of serial operation decorator');
        }

        async function serialOperationAwaredFunction(this: any, ...argv: any[]) {
            const lastPromise = this[id] as Promise<unknown> | undefined;

            const deferred = Defer();

            this[id] = deferred.promise;
            await lastPromise?.then(NOOP, NOOP);

            let result;
            try {
                result = await func.apply(this, argv);

                deferred.resolve(result);
            } catch (err) {
                deferred.reject(err);
            }

            return deferred.promise;
        }

        propDesc.value = serialOperationAwaredFunction;

        return propDesc;
    };

}
