"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.propertyInjectorFactory = void 0;
function propertyInjectorFactory(container) {
    return function injectionDecorator(token) {
        return function injectionDecoratorFunc(tgt, key) {
            const result = container.resolve(token || Reflect.getMetadata('design:type', tgt, key));
            Object.defineProperty(tgt, key, { value: result });
            return;
        };
    };
}
exports.propertyInjectorFactory = propertyInjectorFactory;
//# sourceMappingURL=property-injector.js.map