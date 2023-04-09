
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

export function DefineProperty(desc: PropertyDescriptor) {
    return function definePropertyDecorator(
        tgt: any, key: string | symbol, originalDescriptor?: PropertyDescriptor
    ) {
        if (originalDescriptor) {
            throw new Error('Invalid use of DefineProperty decorator: it cannot be used on a method or getter/setter.');
        }

        Object.defineProperty(tgt, key, desc);

        return;
    };
}

export function SetOnPrototype(value: any) {
    return DefineProperty({ value, enumerable: true, writable: true, configurable: true });
}
