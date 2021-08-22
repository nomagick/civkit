
import type { container as DIContainer, InjectionToken } from 'tsyringe';

export function propertyInjectorFactory(container: typeof DIContainer) {

    return function injectionDecorator<T = any>(token?: InjectionToken<T>) {
        return function injectionDecoratorFunc(tgt: any, key: string | symbol) {
            const result = container.resolve<T>(token || Reflect.getMetadata('design:type', tgt, key));
            Object.defineProperty(tgt, key, { value: result });

            return;
        };
    };
}
