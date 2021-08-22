
import type { container as DIContainer, InjectionToken } from 'tsyringe';

export function propertyInjectorFactory(container: typeof DIContainer) {

    return function injectionDecorator<T = any>(token: InjectionToken<T>) {
        const result = container.resolve<T>(token);

        return function injectionDecoratorFunc(tgt: any, key: string) {

            Object.defineProperty(tgt, key, { value: result });

            return;
        };
    };
}
