import type { container as DIContainer, InjectionToken } from 'tsyringe';
export declare function propertyInjectorFactory(container: typeof DIContainer): <T = any>(token: InjectionToken<T>) => (tgt: any, key: string) => void;
//# sourceMappingURL=property-injector.d.ts.map