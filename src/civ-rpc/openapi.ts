import _ from 'lodash';
import { Readable } from 'stream';
import { inspect } from 'util';
import { STATUS_CODES } from 'http';
import {
    InternalAdditionalPropOptions,
    AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL, AUTOCASTABLE_OPTIONS_SYMBOL,
    isAutoCastableClass,
    PropOptions,
    describeAnonymousValidateFunction
} from '../lib/auto-castable';
import {
    chainEntriesSimple as chainEntries, htmlEscape, isConstructor, isPrimitiveType
} from '../utils';
import { PICK_RPC_PARAM_DECORATION_META_KEY, InternalRPCOptions } from './registry';
import { extractTransferProtocolMeta, TransferProtocolMetadata } from './meta';
import { RPCEnvelope } from './base';
import { describeType } from '../lib/auto-castable-utils';

type PropOptionsLike = Partial<PropOptions<any>> & Partial<InternalRPCOptions> & {
    paramOf?: string;
};

function describeTypes(inputTypes: Function | Function[], joinText = '|') {
    const types = Array.isArray(inputTypes) ? inputTypes : [inputTypes];

    return types.map((x: any) => {
        if (typeof x === 'function') {
            if (isPrimitiveType(x)) {
                return x.name.toLowerCase();
            }

            return x.name;
        }
        if (x instanceof Set) {
            return `${x}`;
        }

        return describeType(x);
    }).join(joinText);
}

export class OpenAPIManager {

    enrichDescriptions: boolean = true;

    classToSchemaMapInput = new Map<any, any>();
    classToSchemaMapOutput = new Map<any, any>();
    refToConstructorMap = new Map<string, any>();
    pathToRPCOptionsMap = new Map<string, [string, string, InternalRPCOptions, { [k: string]: any; }]>();

    primitiveSchemaMap = new Map<any, any>([
        [String, { type: 'string' }],
        [Number, { type: 'number' }],
        [Symbol, { type: 'string', format: 'symbol' }],
        [Boolean, { type: 'boolean' }],
        [Buffer, { type: 'string', format: 'binary' }],
        [Date, { type: 'string', format: 'date-time' }],
        [null, { type: 'string', format: 'null', nullable: true }],
        [undefined, { type: 'string', format: 'undefined', nullable: true }],
        [Object, {
            description: 'Can be any value - string, number, boolean, array or object.',
            nullable: true
        }],
        [Promise, {
            description: 'Can be any value - string, number, boolean, array or object.',
            nullable: true
        }],
        [Array, {
            type: 'array',
            items: {
                nullable: true,
                description: 'Can be any value - string, number, boolean, array or object.',
            }
        }],
    ]);

    predefined = {
        specialConfigProp: [
            'schema',
            'parameter',
            'operation',
            'property',
            'response',
            'request',
            'requestBodyContentType',
        ],
        incompatibleProp: [
            'incompatibles',
            'partOf',
            'primitive',
            'paramOf',
            'typeDescription'
        ]
    };

    protected applySceneMeta(schema: any, meta: PropOptionsLike, scene?: string | string[]) {
        if (!(schema && meta)) {
            return;
        }
        const specialArray = Array.isArray(scene) ? scene : [scene];

        const openAPIConf = meta.ext?.openapi || meta.openapi;

        if (openAPIConf) {
            for (const [k, v] of Object.entries(openAPIConf)) {
                if (this.predefined.specialConfigProp.includes(k)) {
                    if (specialArray.includes(k) && _.isPlainObject(v)) {
                        _.merge(schema, v);
                    }
                    continue;
                }
            }
        }

        return schema;
    }

    protected applyMeta(schema: any, meta: PropOptionsLike, special?: string | string[]) {
        if (!(schema && meta)) {
            return;
        }
        const specialArray = Array.isArray(special) ? special : [special];

        const incompatibleMeta: any = {};

        if (meta.name) {
            schema.summary = `${meta.name || meta.desc}`;
        }

        if (meta.desc) {
            schema.description = meta.desc;
        }
        if (meta.markdown) {
            schema.description = meta.markdown;
        }
        if (meta.paramOf) {
            incompatibleMeta.paramOf = meta.paramOf;
        }
        if (meta.partOf) {
            incompatibleMeta.partOf = meta.partOf;
        }
        if (meta.paramOf || meta.partOf) {
            incompatibleMeta.typeDescription = this.describeType(meta);
        }
        if (meta.required) {
            schema.required = true;
            incompatibleMeta.required = true;
        }
        if (meta.deprecated) {
            schema.deprecated = true;
            incompatibleMeta.deprecated = true;
        }
        if (meta.default) {
            schema.default = meta.default;
            incompatibleMeta.default = meta.default;
        }

        if (meta.defaultFactory) {
            incompatibleMeta.defaultFactory = meta.defaultFactory;
        }
        if (meta.validate) {
            incompatibleMeta.validate = meta.validate;
        }
        if (meta.validateCollection) {
            incompatibleMeta.validateCollection = meta.validateCollection;
        }

        if (Array.isArray(meta.tags)) {
            schema.tags = meta.tags;
        }

        if (!_.isEmpty(incompatibleMeta)) {
            schema.incompatibles = incompatibleMeta;
        }

        const openAPIConf = meta.ext?.openapi || meta.openapi;

        if (openAPIConf) {
            for (const [k, v] of Object.entries(openAPIConf)) {
                if (this.predefined.specialConfigProp.includes(k)) {
                    if (specialArray.includes(k) && _.isPlainObject(v)) {
                        _.merge(schema, v);
                    }
                    continue;
                }
                _.merge(schema, { [k]: v });
            }
        }

        return schema;
    }

    protected consumeIncompatibles(schema: any) {
        if (!schema.incompatibles) {
            return;
        }
        const descVecs: string[] = [];
        const incompatibles: PropOptionsLike = schema.incompatibles;

        if (this.enrichDescriptions) {
            if (schema.deprecated || incompatibles.deprecated) {
                descVecs.push(`[DEPRECATED]`);
            }

            if (schema.required || incompatibles.required) {
                descVecs.push(`[REQUIRED]`);
            }
            if (schema.description) {
                descVecs.push(schema.description);
            }

            if (incompatibles.typeDescription) {
                descVecs.push(htmlEscape`- Cast to: < **${incompatibles.typeDescription}** >`);
            }
            if (incompatibles.paramOf) {
                descVecs.push(htmlEscape`- Endpoint parameter of *${incompatibles.paramOf}*`);
            }
            if (incompatibles.partOf) {
                descVecs.push(htmlEscape`- Member of <${incompatibles.partOf}>`);
            }

            if (incompatibles.validate) {
                const validatorNames = (Array.isArray(incompatibles.validate) ?
                    incompatibles.validate : [incompatibles.validate])
                    .map(describeAnonymousValidateFunction).filter(Boolean);

                descVecs.push(htmlEscape`- Some validators will be applied on value(s): ${validatorNames}`);
            }

            if (incompatibles.validateCollection) {
                const validatorNames = (Array.isArray(incompatibles.validateCollection) ?
                    incompatibles.validateCollection : [incompatibles.validateCollection])
                    .map(describeAnonymousValidateFunction).filter(Boolean);

                descVecs.push(htmlEscape`- Some validators will be applied on the collection: ${validatorNames}`);
            }

            if (incompatibles.default) {
                descVecs.push(htmlEscape`- Defaults to: ${inspect(incompatibles.default, { depth: 6 })}`);
            }
            if (incompatibles.defaultFactory) {
                if (incompatibles.defaultFactory.name) {
                    descVecs.push(htmlEscape`- A dynamic default value will be provided on server side based on: ${incompatibles.defaultFactory.name}`);
                } else {
                    descVecs.push(`- A dynamic default value will be provided on server side`);
                }
            }

            schema.description = descVecs.join('\n\n');
        }


        for (const prop of this.predefined.incompatibleProp) {
            delete schema[prop];
        }

        if (typeof schema.required === 'boolean' && !schema.in) {
            delete schema.required;
        }
    }

    protected getRefNameOfConstructor(inputClass: any, direction: 'input' | 'output' = 'input') {
        const name = describeType(inputClass).replaceAll('~', '~0').replaceAll('/', '~1');

        const propOptions = inputClass?.[AUTOCASTABLE_OPTIONS_SYMBOL];
        if (propOptions) {
            for (const [k, v] of chainEntries(propOptions)) {
                if (v.path !== k) {
                    return direction === 'input' ? `Dto<${name}>` : name;
                }
            }
        }

        return name;
    }

    protected getSchemaRef(inputClass: any = Object, direction: 'input' | 'output' = 'input') {
        if (this.primitiveSchemaMap.has(inputClass)) {
            return {
                ...this.primitiveSchemaMap.get(inputClass)
            };
        }
        if (!isConstructor(inputClass) && !(inputClass instanceof Set)) {
            return undefined;
        }
        const theMap = direction === 'input' ? this.classToSchemaMapInput : this.classToSchemaMapOutput;
        if (!theMap.has(inputClass)) {
            // Placeholder to break circular reference
            theMap.set(inputClass, {});
            const schema = this.constructorToOpenAPISchema(inputClass, direction);
            if (!schema) {
                theMap.delete(inputClass);

                return undefined;
            }
            if (this.primitiveSchemaMap.has(inputClass)) {
                theMap.delete(inputClass);

                return {
                    ...this.primitiveSchemaMap.get(inputClass)
                };
            }
            theMap.set(inputClass, schema);
        }

        const refVal = `#/components/schemas/${this.getRefNameOfConstructor(inputClass, direction)}`;
        this.refToConstructorMap.set(refVal, inputClass);

        return {
            allOf: [
                { $ref: refVal }
            ]
        };
    }

    protected getConstructorFromRef(ref: string) {
        return this.refToConstructorMap.get(ref);
    }

    protected getRef(schema: any) {
        if (schema?.$ref) {
            return schema.$ref;
        }

        if (schema?.allOf?.length === 1 && schema.allOf[0]?.$ref) {
            return schema.allOf[0].$ref;
        }
    }

    protected unref(ref: string, direction: 'input' | 'output' = 'input') {
        const constructor = this.getConstructorFromRef(ref);
        if (constructor) {
            return this.constructorToOpenAPISchema(constructor, direction);
        }
        return undefined;
    }

    protected unRefSchema(schema: any, direction: 'input' | 'output' = 'input') {
        if (schema?.$ref) {
            return { ...schema, ...this.unref(schema.$ref, direction), $ref: undefined };
        }

        if (schema?.allOf?.length === 1 && schema.allOf[0]?.$ref) {
            return { ...schema, ...this.unref(schema.allOf[0].$ref, direction), allOf: undefined };
        }

        return schema;
    }

    protected flattenSchema(inputSchema: any) {
        if (!inputSchema) {
            return undefined;
        }

        let schema = this.unRefSchema(inputSchema);

        let schemaModified = false;

        if (schema.type === 'array') {
            const origSchema = schema;
            schema = {
                ..._.omit(schema, 'type', 'items', 'default'),
                ..._.omit(this.unRefSchema(schema.items), 'description', 'title'),
            };

            if (Array.isArray(origSchema.default) && origSchema.default.length === 1) {
                schema.default = origSchema.default[0];
            }

            schemaModified = true;
        }

        if (!schema) {
            return undefined;
        }

        if (schema.type === 'object') {
            return undefined;
        }


        if (Array.isArray(schema.allOf)) {
            const allOf = schema.allOf.map((x: any) => this.flattenSchema(x)).filter(Boolean);

            if (!allOf.length) {
                return undefined;
            }

            if (schema.allOf.length !== allOf.length) {
                schemaModified = true;
            }

            schema = { ...schema, allOf };
        } else if (Array.isArray(schema.anyOf)) {
            const anyOf = schema.anyOf.map((x: any) => this.flattenSchema(x)).filter(Boolean);

            if (!anyOf.length) {
                return undefined;
            }

            if (schema.anyOf.length !== anyOf.length) {
                schemaModified = true;
            }

            schema = { ...schema, anyOf };
        } else if (Array.isArray(schema.oneOf)) {
            const oneOf = schema.oneOf.map((x: any) => this.flattenSchema(x)).filter(Boolean);

            if (!oneOf.length) {
                return undefined;
            }

            if (schema.oneOf.length !== oneOf.length) {
                schemaModified = true;
            }

            schema = { ...schema, oneOf };
        }

        if (schemaModified) {
            return schema;
        }

        return inputSchema;
    }

    constructorToOpenAPISchema(
        input: any = Object,
        direction: 'input' | 'output' = 'input',
        useRef: boolean = true
    ) {
        let final: any = undefined;

        let additionalOptionsApplied = false;
        let shouldAddToPrimitives = false;
        do {
            if (isAutoCastableClass(input)) {
                const openAPIDesc: any = {
                    title: input.name,
                };
                const properties: { [k: string]: any; } = {};
                const requiredProperties: string[] = [];
                const propOptions: { [k: string]: PropOptions<unknown>; } =
                    input?.[AUTOCASTABLE_OPTIONS_SYMBOL];
                const additionalOptions: InternalAdditionalPropOptions<unknown> | undefined =
                    input[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL];
                let considerProps = true;
                if (additionalOptions?.arrayOf) {
                    considerProps = false;
                    const schema = this.propOptionsLikeToOpenAPISchema(additionalOptions, direction, useRef);
                    if (schema) {
                        openAPIDesc.type = schema.type;
                        openAPIDesc.items = schema.items;
                        if (schema.description) {
                            openAPIDesc.description = schema.description;
                        }
                    }
                } else if (additionalOptions?.dictOf) {
                    const schema = this.propOptionsLikeToOpenAPISchema(additionalOptions, direction, useRef);
                    if (schema) {
                        openAPIDesc.type = schema.type;
                        openAPIDesc.additionalProperties = schema.additionalProperties;
                    }
                } else if (additionalOptions?.type) {
                    considerProps = false;
                    const schema = this.propOptionsLikeToOpenAPISchema(additionalOptions, direction, useRef);
                    if (schema) {
                        Object.assign(
                            openAPIDesc,
                            _.omit(schema, 'title', 'description'),
                            {
                                title: `${input.name}&${schema.title}`,
                            }
                        );
                    }
                }
                if (propOptions && considerProps) {
                    for (const [k, v] of chainEntries(propOptions)) {
                        const prop = direction === 'input' ? v.path : k;
                        if (typeof prop !== 'string') {
                            continue;
                        }
                        properties[prop] = this.propOptionsLikeToOpenAPISchema(v, direction, useRef);
                        if (properties[prop]) {
                            this.applyMeta(properties[prop], {
                                partOf: input.name,
                                ...v,
                            }, ['property', 'schema']);
                        } else {
                            delete properties[prop];
                        }
                    }

                    Object.assign(openAPIDesc, {
                        type: 'object',
                        properties,
                        required: requiredProperties
                    });
                }

                if (additionalOptions) {
                    this.applyMeta(openAPIDesc, additionalOptions, 'schema');
                }
                additionalOptionsApplied = true;

                for (const [k, v] of Object.entries(properties)) {
                    if (v.omitted) {
                        delete properties[k];
                        continue;
                    }

                    if (v.required) {
                        requiredProperties.push(k);
                    }

                    this.consumeIncompatibles(v);
                }

                if (openAPIDesc.omitted) {
                    final = undefined;
                    break;
                }

                final = openAPIDesc;

                if (openAPIDesc.type !== 'object') {
                    delete openAPIDesc.properties;
                    delete openAPIDesc.required;
                }
                if (!openAPIDesc.required?.length) {
                    delete openAPIDesc.required;
                }

                if (final.primitive) {
                    shouldAddToPrimitives = true;
                }
                break;
            } else if (input?.prototype instanceof Readable) {
                final = {
                    type: 'string', format: 'binary',
                    description: `Binary data (stream)`
                };
                break;
            } else if (input?.prototype instanceof Buffer) {
                final = {
                    type: 'string', format: 'binary',
                    description: `Binary data (buffed)`
                };
                break;
            } else if (input instanceof Set) {
                // enum
                const values = Array.from(input);
                const description = `Enum<${input.toString()}>`;
                if (typeof values[0] === 'string') {
                    final = { type: 'string', enum: Array.from(input), description };
                    break;
                } else if (Number.isInteger(values[0])) {
                    final = { type: 'integer', enum: Array.from(input), description };
                    break;
                } else {
                    final = { type: 'string', description };
                }
                break;
            } else if (this.primitiveSchemaMap.has(input)) {
                final = { ...this.primitiveSchemaMap.get(input) };
                break;
            } else if (isConstructor(input)) {
                final = {
                    type: 'string', format: input.name,
                };
                shouldAddToPrimitives = true;
                break;
            }
        } while (false);

        if (!additionalOptionsApplied && input?.[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL]) {
            const additionalOptions: InternalAdditionalPropOptions<unknown> | undefined =
                input[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL];

            if (additionalOptions) {
                this.applyMeta(final, additionalOptions, 'schema');
            }

            if (final.omitted) {
                return undefined;
            }
        }

        if (shouldAddToPrimitives) {
            this.consumeIncompatibles(final);
            this.primitiveSchemaMap.set(input, final);
        }

        return final;
    }

    protected autoTypesToOpenAPISchema(
        input: any | any[] = Object,
        direction: 'input' | 'output' = 'input',
        useRef: boolean = true
    ) {

        if (Array.isArray(input)) {
            if (input.length === 1) {
                return useRef ?
                    this.getSchemaRef(input[0], direction) :
                    this.constructorToOpenAPISchema(input[0], direction, false);
            }
            const schemas = input.map((x) => useRef ?
                this.getSchemaRef(x, direction) :
                this.constructorToOpenAPISchema(x, direction, false)
            ).filter(Boolean);

            if (!schemas.length) {
                return undefined;
            }

            return {
                oneOf: schemas
            };
        }

        return useRef ?
            this.getSchemaRef(input, direction) :
            this.constructorToOpenAPISchema(input, direction, false);
    }

    protected autoCollectMetaFromTypes(
        input: any | any[] = Object,
        scene?: string | string[]
    ) {
        const final: any = {};
        if (Array.isArray(input)) {
            for (const x of input) {
                const additionalOptions: InternalAdditionalPropOptions<unknown> | undefined =
                    x?.[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL];

                const partial: any = {};
                if (additionalOptions) {
                    scene ?
                        this.applySceneMeta(partial, additionalOptions, scene) :
                        this.applyMeta(partial, additionalOptions);
                }

                if (partial.omitted) {
                    continue;
                }

                _.merge(final, partial);
            }

            return final;
        }

        const additionalOptions: InternalAdditionalPropOptions<unknown> | undefined =
            input?.[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL];

        if (additionalOptions) {
            scene ?
                this.applySceneMeta(final, additionalOptions, scene) :
                this.applyMeta(final, additionalOptions);
        }

        if (final.omitted) {
            return {};
        }

        return final;
    }

    propOptionsLikeToOpenAPISchema(
        conf: PropOptionsLike,
        direction: 'input' | 'output' = 'input',
        useRef: boolean = true
    ): any {
        let final: any = {};
        if (conf.arrayOf) {
            const schema = this.autoTypesToOpenAPISchema(conf.arrayOf, direction, useRef);
            final = schema ? {
                type: 'array',
                items: schema
            } : undefined;
        } else if (conf.dictOf) {
            const schema = this.autoTypesToOpenAPISchema(conf.dictOf, direction, useRef);
            final = schema ? {
                type: 'object',
                additionalProperties: schema
            } : undefined;
        } else if (conf.returnArrayOf) {
            const schema = this.autoTypesToOpenAPISchema(conf.returnArrayOf, direction, useRef);
            final = schema ? {
                type: 'array',
                items: schema
            } : undefined;
        } else if (conf.returnDictOf) {
            const schema = this.autoTypesToOpenAPISchema(conf.returnDictOf, direction, useRef);
            final = schema ? {
                type: 'object',
                additionalProperties: schema
            } : undefined;
        } else if (conf.returnType) {
            const schema = this.autoTypesToOpenAPISchema(conf.returnType, direction, useRef);
            final = schema;
        } else if (conf.type) {
            const schema = this.autoTypesToOpenAPISchema(conf.type, direction, useRef);
            final = schema;
        } else if (conf.throws) {
            const schema = this.autoTypesToOpenAPISchema(conf.throws, direction, useRef);
            final = schema;
        }

        return final;
    }

    protected describeType(conf: PropOptionsLike) {
        if (conf.arrayOf) {
            return `Array<${describeTypes(conf.arrayOf)}>`;
        } else if (conf.dictOf) {
            return `Record<string, ${describeTypes(conf.dictOf)}>`;
        } else if (conf.returnArrayOf) {
            return `Array<${describeTypes(conf.returnArrayOf)}>`;
        } else if (conf.returnDictOf) {
            return `Record<string, ${describeTypes(conf.returnDictOf)}>`;
        } else if (conf.returnType) {
            return describeTypes(conf.returnType);
        } else if (conf.type) {
            return describeTypes(conf.type);
        }

        return 'Unknown';
    }

    protected collectOperationMeta(
        conf: PropOptionsLike
    ): any {
        const final: any = {};

        if (conf.paramTypes) {
            const paramPickerMeta = Reflect.getMetadata(PICK_RPC_PARAM_DECORATION_META_KEY, conf.hostProto);
            const paramPickerConf = (paramPickerMeta?.[conf.nameOnProto]) || [];

            if (Array.isArray(conf.paramTypes)) {
                for (const [i, x] of conf.paramTypes.entries()) {
                    const conf2 = {
                        type: x,
                        path: isAutoCastableClass(x) ? undefined : conf.paramNames?.[i],
                        ...paramPickerConf[i]
                    };
                    _.merge(final, this.collectOperationMeta(
                        _.pick(conf2, ['type', 'arrayOf', 'dictOf', 'returnType', 'returnArrayOf', 'returnDictOf']),
                    ));
                }
            }
        } else if (conf.arrayOf) {
            _.merge(final, this.autoCollectMetaFromTypes(conf.arrayOf, ['request', 'operation']));
        } else if (conf.dictOf) {
            _.merge(final, this.autoCollectMetaFromTypes(conf.dictOf, ['request', 'operation']));
        } else if (conf.type) {
            _.merge(final, this.autoCollectMetaFromTypes(conf.type, ['request', 'operation']));
        }

        if (conf.returnArrayOf) {
            _.merge(final, this.autoCollectMetaFromTypes(conf.returnArrayOf, ['response', 'operation']));
        } else if (conf.returnDictOf) {
            _.merge(final, this.autoCollectMetaFromTypes(conf.returnDictOf, ['response', 'operation']));
        } else if (conf.returnType) {
            _.merge(final, this.autoCollectMetaFromTypes(conf.returnType, ['response', 'operation']));
        }

        this.applyMeta(final, conf, 'operation');

        return final;
    }

    protected getShallowPropertiesFromFullSchema(inputSchema: any) {
        const parameters: any = {};
        if (this.getRef(inputSchema)) {
            Object.assign(parameters, this.getShallowPropertiesFromFullSchema(this.unRefSchema(inputSchema)));
        }

        if (inputSchema.type === 'object' && inputSchema.properties) {
            for (const [k, v] of Object.entries<any>(inputSchema.properties)) {
                const flattened = this.flattenSchema(v);
                if (flattened) {
                    parameters[k] = flattened;
                }
            }
        } else if (inputSchema.type === 'array' && inputSchema.items) {
            Object.assign(parameters, this.getShallowPropertiesFromFullSchema(inputSchema.items));
        }

        if (Array.isArray(inputSchema.allOf)) {
            for (const x of inputSchema.allOf) {
                Object.assign(parameters, this.getShallowPropertiesFromFullSchema(x));
            }
        }

        if (Array.isArray(inputSchema.anyOf)) {
            for (const x of inputSchema.anyOf) {
                Object.assign(parameters, this.getShallowPropertiesFromFullSchema(x));
            }
        }

        if (Array.isArray(inputSchema.oneOf)) {
            for (const x of inputSchema.oneOf) {
                Object.assign(parameters, this.getShallowPropertiesFromFullSchema(x));
            }
        }

        return parameters;
    }

    protected createParameterObject(rpcOptions: InternalRPCOptions) {
        const properties: any = {};

        const paramPickerMeta = Reflect.getMetadata(PICK_RPC_PARAM_DECORATION_META_KEY, rpcOptions.hostProto);
        const paramPickerConf = (paramPickerMeta ? paramPickerMeta[rpcOptions.nameOnProto] : undefined) || [];

        if (Array.isArray(rpcOptions.paramTypes)) {
            for (const [i, x] of rpcOptions.paramTypes.entries()) {
                const conf = {
                    type: x,
                    path: isAutoCastableClass(x) ? undefined : rpcOptions.paramNames?.[i],
                    paramOf: rpcOptions.name,
                    ...paramPickerConf[i]
                } as PropOptions<unknown>;
                const partialSchema = this.propOptionsLikeToOpenAPISchema(conf, 'input');
                if (!partialSchema) {
                    continue;
                }

                if (conf.path) {
                    const flattenedSchema = this.flattenSchema(partialSchema);
                    if (flattenedSchema) {
                        properties[conf.path] = _.cloneDeep(flattenedSchema);
                        this.applyMeta(properties[conf.path], conf, ['parameter', 'request']);
                    }

                    continue;
                }

                const shallowVec = this.getShallowPropertiesFromFullSchema(partialSchema);
                if (!_.isEmpty(shallowVec)) {
                    Object.assign(properties, shallowVec);
                }
            }
        }

        const final: any = {};

        for (const [k, v] of Object.entries<any>(properties)) {
            if (v.omitted) {
                continue;
            }
            final[k] = {
                name: k,
                in: 'query',
                schema: v
            };
        }


        return final;

    }

    createRequestBodyObject(rpcOptions: InternalRPCOptions) {
        const paramPickerMeta = Reflect.getMetadata(PICK_RPC_PARAM_DECORATION_META_KEY, rpcOptions.hostProto);
        const paramPickerConf = (paramPickerMeta ? paramPickerMeta[rpcOptions.nameOnProto] : undefined) || [];

        let openAPISchemas: any[] = [];
        const shallowObj: any = {};
        const nonDtoParams: any = {};
        const nonDtoParamsRequired: string[] = [];

        const recurrenceDetector = new Set<string>();

        if (Array.isArray(rpcOptions.paramTypes)) {
            for (const [i, x] of rpcOptions.paramTypes.entries()) {
                const conf = {
                    type: x,
                    path: isAutoCastableClass(x) ? undefined : rpcOptions.paramNames?.[i],
                    paramOf: rpcOptions.name,
                    ...paramPickerConf[i]
                } as PropOptionsLike;

                const partialSchema = this.propOptionsLikeToOpenAPISchema(conf, 'input');

                if (!partialSchema) {
                    continue;
                }

                if (conf.path) {
                    const flattenedSchema = this.flattenSchema(partialSchema);
                    if (flattenedSchema) {
                        shallowObj[conf.path] = _.cloneDeep(flattenedSchema);
                        this.applyMeta(shallowObj[conf.path], conf, ['parameter', 'request']);
                    }

                    nonDtoParams[conf.path] = _.cloneDeep(partialSchema);
                    this.applyMeta(nonDtoParams[conf.path], conf, 'request');
                    if (nonDtoParams[conf.path].required && typeof conf.path === 'string') {
                        nonDtoParamsRequired.push(conf.path);
                    }

                    continue;
                }

                openAPISchemas.push(partialSchema);

                const shallowVec = this.getShallowPropertiesFromFullSchema(partialSchema);
                if (!_.isEmpty(shallowVec)) {
                    Object.assign(shallowObj, shallowVec);
                }
            }
        }

        if (!_.isEmpty(nonDtoParams)) {
            openAPISchemas.push({
                type: 'object', properties: nonDtoParams,
                required: nonDtoParamsRequired.length ? nonDtoParamsRequired : undefined
            });
        }

        for (const [k, v] of Object.entries<any>(shallowObj)) {
            if (v.omitted) {
                delete shallowObj[k];
                continue;
            }

            const ref = this.getRef(v);
            if (ref) {
                recurrenceDetector.add(ref);
            }

            this.consumeIncompatibles(v);
        }

        for (const [k, v] of Object.entries<any>(nonDtoParams)) {
            if (v.omitted) {
                delete nonDtoParams[k];
                continue;
            }

            const ref = this.getRef(v);
            if (ref) {
                recurrenceDetector.add(ref);
            }

            this.consumeIncompatibles(v);
        }

        const rpcOpenAPIConfig = rpcOptions.openapi || rpcOptions.ext?.openapi;
        const requestBodyContentType = rpcOpenAPIConfig?.requestBodyContentType;

        openAPISchemas = openAPISchemas.map((x) => {
            const ref = this.getRef(x);

            if (!ref) {
                return x;
            }

            if (recurrenceDetector.has(ref)) {
                return this.unRefSchema(x);
            }

            if (
                Object.keys(x).length === 1 &&
                x.allOf?.length === 1
            ) {
                return x.allOf[0];
            }

            return x;
        });

        if (requestBodyContentType) {
            if (Array.isArray(requestBodyContentType)) {
                return {
                    content: requestBodyContentType.reduce((acc, x) => {
                        acc[x] = { schema: { allOf: openAPISchemas } };
                    }, {})
                };
            }

            return {
                content: {
                    [requestBodyContentType]: { schema: { allOf: openAPISchemas } }
                }
            };
        }

        return {
            content: {
                'application/json': { schema: { allOf: openAPISchemas } },
                'multipart/form-data': { schema: { allOf: openAPISchemas } },
                'application/x-www-form-urlencoded': {
                    schema: {
                        type: 'object',
                        properties: shallowObj
                    }
                }
            }
        };
    }

    createRPCParametersSchemaObject(rpcOptions: InternalRPCOptions) {
        const paramPickerMeta = Reflect.getMetadata(PICK_RPC_PARAM_DECORATION_META_KEY, rpcOptions.hostProto);
        const paramPickerConf = (paramPickerMeta ? paramPickerMeta[rpcOptions.nameOnProto] : undefined) || [];

        let openAPISchemas: any[] = [];
        const nonDtoParams: any = {};
        const nonDtoParamsRequired: string[] = [];

        const recurrenceDetector = new Set<string>();

        if (Array.isArray(rpcOptions.paramTypes)) {
            for (const [i, x] of rpcOptions.paramTypes.entries()) {
                const conf = {
                    type: x,
                    path: isAutoCastableClass(x) ? undefined : rpcOptions.paramNames?.[i],
                    paramOf: rpcOptions.name,
                    ...paramPickerConf[i]
                } as PropOptionsLike;

                const partialSchema = this.propOptionsLikeToOpenAPISchema(conf, 'input', false);

                if (!partialSchema) {
                    continue;
                }

                if (conf.path) {
                    nonDtoParams[conf.path] = _.cloneDeep(partialSchema);
                    this.applyMeta(nonDtoParams[conf.path], conf, 'request');
                    if (nonDtoParams[conf.path].required && typeof conf.path === 'string') {
                        nonDtoParamsRequired.push(conf.path);
                    }

                    continue;
                }

                openAPISchemas.push(partialSchema);
            }
        }

        if (!_.isEmpty(nonDtoParams)) {
            openAPISchemas.push({
                type: 'object', properties: nonDtoParams,
                required: nonDtoParamsRequired.length ? nonDtoParamsRequired : undefined
            });
        }

        for (const [k, v] of Object.entries<any>(nonDtoParams)) {
            if (v.omitted) {
                delete nonDtoParams[k];
                continue;
            }

            const ref = this.getRef(v);
            if (ref) {
                recurrenceDetector.add(ref);
            }

            this.consumeIncompatibles(v);
        }

        openAPISchemas = openAPISchemas.map((x) => {
            const ref = this.getRef(x);

            if (!ref) {
                return x;
            }

            if (recurrenceDetector.has(ref)) {
                return this.unRefSchema(x);
            }

            if (
                Object.keys(x).length === 1 &&
                x.allOf?.length === 1
            ) {
                return x.allOf[0];
            }

            return x;
        });

        return openAPISchemas.length === 1 ? openAPISchemas[0] : { allOf: openAPISchemas };
    }

    createResponsesObject(inputRpcOptions: InternalRPCOptions, inputEnvelopeClass: typeof RPCEnvelope) {
        const codeTypeMap = new Map<string, [object, object | undefined][]>();
        const codeHeaderMap = new Map<string, [string, string][]>();

        const rpcOptions = inputRpcOptions;

        let defaultEnvelope = new inputEnvelopeClass();
        if (inputRpcOptions?.envelope) {
            defaultEnvelope = new inputRpcOptions.envelope();
        } else if (inputRpcOptions?.envelope === null) {
            defaultEnvelope = new RPCEnvelope();
        }

        const defaultWrappedOptions = defaultEnvelope.describeWrap(rpcOptions) as InternalRPCOptions;

        const defaultReturnTypes = rpcOptions.returnArrayOf ||
            rpcOptions.returnDictOf;
        if (defaultReturnTypes) {
            const partialSchema = this.propOptionsLikeToOpenAPISchema(defaultWrappedOptions, 'output');
            this.applySceneMeta(partialSchema, defaultWrappedOptions, 'response');
            this.consumeIncompatibles(partialSchema);
            codeTypeMap.set(`200::application/json`, [[partialSchema, undefined]]);
        } else if (rpcOptions.returnType) {
            const returnTypes = Array.isArray(rpcOptions.returnType) ? rpcOptions.returnType : [rpcOptions.returnType];

            const wrappedOptions = [];
            let allUsingDefaultEnvelope = true;
            for (const x of returnTypes) {
                const tpm = extractTransferProtocolMeta(x?.prototype);

                const envelope = tpm?.envelope ?
                    new tpm.envelope() :
                    tpm?.envelope === null ?
                        new RPCEnvelope() :
                        defaultEnvelope;
                if (envelope !== defaultEnvelope) {
                    allUsingDefaultEnvelope = false;
                    const partialWrappedRpcOptions = envelope.describeWrap({
                        ...rpcOptions,
                        returnType: x,
                        throws: undefined,
                        returnArrayOf: undefined,
                        returnDictOf: undefined
                    }) as InternalRPCOptions;
                    wrappedOptions.push(partialWrappedRpcOptions);
                }
            }
            if (allUsingDefaultEnvelope) {
                wrappedOptions.push(defaultWrappedOptions);
            }

            for (const wrappedRpcOptions of wrappedOptions) {
                const wrappedTypes = Array.isArray(wrappedRpcOptions?.returnType) ?
                    wrappedRpcOptions.returnType :
                    [wrappedRpcOptions.returnType];

                for (const wrappedType of wrappedTypes) {
                    const wrappedTpm = extractTransferProtocolMeta(wrappedType?.prototype);
                    const codeKey = `${wrappedTpm?.code || 200}`;
                    const codeTypeKey = `${codeKey}::${wrappedTpm?.contentType || 'application/json'}`;
                    const codeTypeValue = codeTypeMap.get(codeTypeKey);
                    const partialSchema = this.autoTypesToOpenAPISchema(wrappedType, 'output');
                    this.applySceneMeta(partialSchema, rpcOptions, 'response');
                    this.consumeIncompatibles(partialSchema);
                    if (codeTypeValue) {
                        codeTypeValue.push([partialSchema, this.tpmToHeaders(wrappedType, wrappedTpm)]);
                    } else {
                        codeTypeMap.set(codeTypeKey, [[partialSchema, this.tpmToHeaders(wrappedType, wrappedTpm)]]);
                    }

                    if (wrappedTpm?.headers) {
                        for (const [k, v] of Object.entries(wrappedTpm.headers)) {
                            const codeHeaderKey = `${codeKey}::${k}`;
                            const codeHeaderValue = codeHeaderMap.get(codeHeaderKey);
                            if (codeHeaderValue) {
                                codeHeaderValue.push([`${v}`, `Response header "**${k}**"${wrappedType ? ` from {${wrappedType?.name}}` : ''}`] as [string, string]);
                            } else {
                                codeHeaderMap.set(codeHeaderKey, [
                                    [`${v}`, `Response header "**${k}**"${wrappedType ? ` from {${wrappedType?.name}}` : ''}`]
                                ]);
                            }
                        }
                    }
                }
            }
        }
        if (rpcOptions.throws) {
            const wrappedErrors = Array.isArray(defaultWrappedOptions.throws) ? defaultWrappedOptions.throws : [defaultWrappedOptions.throws];
            for (const wrappedError of wrappedErrors) {
                const wrappedTpm = extractTransferProtocolMeta(wrappedError?.prototype);
                const codeKey = `${wrappedTpm?.code || 500}`;
                const codeTypeKey = `${codeKey}::${wrappedTpm?.contentType || 'text/plain'}`;
                const codeTypeValue = codeTypeMap.get(codeTypeKey);
                const partialSchema = this.autoTypesToOpenAPISchema(wrappedError, 'output');
                this.applySceneMeta(partialSchema, rpcOptions, 'response');
                this.consumeIncompatibles(partialSchema);
                if (codeTypeValue) {
                    codeTypeValue.push([partialSchema, this.tpmToHeaders(wrappedError, wrappedTpm)]);
                } else {
                    codeTypeMap.set(codeTypeKey, [[partialSchema, this.tpmToHeaders(wrappedError, wrappedTpm)]]);
                }

                if (wrappedTpm?.headers) {
                    for (const [k, v] of Object.entries(wrappedTpm.headers)) {
                        const codeHeaderKey = `${codeKey}::${k}`;
                        const codeHeaderValue = codeHeaderMap.get(codeHeaderKey);
                        if (codeHeaderValue) {
                            codeHeaderValue.push([`${v}`, `Response header "**${k}**"${wrappedError ? ` from {${wrappedError?.name}}` : ''}`]);
                        } else {
                            codeHeaderMap.set(codeHeaderKey, [
                                [`${v}`, `Response header "**${k}**"${wrappedError ? ` from {${wrappedError?.name}}` : ''}`]
                            ]);
                        }
                    }
                }
            }
        }

        const final: { [code: string]: any; } = {};
        for (const [k, v] of codeTypeMap.entries()) {
            const [code, contentType] = k.split('::');
            const propMap = final[code]?.content || {};
            const headers = final[code]?.headers || {};
            final[code] = {
                description: STATUS_CODES[code] || 'User Defined',
                content: propMap,
                headers
            };

            if (v.length === 1) {
                propMap[contentType] = { schema: v[0][0] };
                this.mergeHeadersObject(headers, v[0][1]);
            } else {
                propMap[contentType] = {
                    schema: {
                        oneOf: v.map((x) => {
                            this.mergeHeadersObject(headers, x[1]);

                            return x[0];
                        })
                    }
                };
            }
        }

        for (const [k, v] of codeHeaderMap.entries()) {
            const [code, header] = k.split('::');
            const responseObject = final[code] || {
                description: STATUS_CODES[code] || 'User Defined'
            };
            final[code] = responseObject;

            const headersMap = responseObject?.headers || {};
            responseObject.headers = headersMap;

            if (v.length === 1) {
                const [headerVal, headerDesc] = v[0];
                headersMap[header] = {
                    description: headerDesc,
                    schema: {
                        type: 'string',
                        default: headerVal
                    }
                };
            } else {
                headersMap[header] = {
                    description: `Response header "**${header}**" from multiple types`,
                    schema: {
                        oneOf: v.map(([headerVal, headerDesc]) => {
                            return {
                                type: 'string',
                                description: headerDesc,
                                default: headerVal,
                            };
                        })
                    }
                };
            }
        }

        return final;
    }

    protected tpmToHeaders(host?: Function, tpm?: TransferProtocolMetadata) {
        if (!tpm) {
            return {};
        }
        const headers: any = {};

        for (const k of Object.keys(tpm?.headers || {})) {
            headers[k] = {
                description: htmlEscape`- Member of <${host ? describeTypes(host) : 'Unknown'}>`,
                schema: {
                    type: 'string',
                    format: k,
                }
            };
        }

        return headers;
    }

    protected mergeHeadersObject(a: any, b?: object) {
        if (!b) {
            return a;
        }

        for (const [k, v] of Object.entries(b)) {
            if (a[k]?.description && v?.description) {
                a[k].description = `${a[k].description}\n${v.description}`;
            } else {
                a[k] = v;
            }
        }

        return a;
    }

    protected createOperationObject(rpcOptions: InternalRPCOptions, envelopeClass: typeof RPCEnvelope) {
        const parametersObject = this.createParameterObject(rpcOptions);

        for (const x of Object.values<any>(parametersObject)) {
            if (x?.schema) {
                this.consumeIncompatibles(x.schema);
            }
            this.consumeIncompatibles(x);
        }

        const requestBodyObject = this.createRequestBodyObject(rpcOptions);
        const responsesObject = this.createResponsesObject(rpcOptions, envelopeClass);
        const final: any = {
            tags: ['[[NotCategorized]]'],
            parameters: parametersObject,
            requestBody: requestBodyObject,
            responses: responsesObject,
        };

        _.merge(final, this.collectOperationMeta(rpcOptions));
        this.consumeIncompatibles(final);

        return final;
    }

    document(
        path: string,
        inputMethod: string | string[],
        rpcOptions: InternalRPCOptions,
        additionalMeta: { [k: string]: any; } = {}
    ) {
        const methodArray = Array.isArray(inputMethod) ? inputMethod : [inputMethod];

        for (const method of methodArray) {
            const lowerMethod = method.toLowerCase();
            this.pathToRPCOptionsMap.set(
                `${lowerMethod} ${path}`,
                [
                    lowerMethod,
                    path,
                    rpcOptions,
                    {
                        ...additionalMeta,
                        method,
                        tags: _.uniq([
                            ...(rpcOptions.tags || rpcOptions.openapi?.tags || rpcOptions.ext?.openapi?.tags || []),
                            ...(additionalMeta.tags || [])
                        ].map((x) => x.toString().toLowerCase())),
                    }
                ]
            );
        }
    }

    protected createPathsObject(
        envelopeClass: typeof RPCEnvelope,
        query?: {
            [k: string]: string | string[] | undefined;
        }
    ) {
        const paths: any = {};

        outerLoop:
        for (const [lowerMethod, path, rpcOptions, additionalMeta] of this.pathToRPCOptionsMap.values()) {
            if (!_.isEmpty(query)) {
                for (const [k, v] of Object.entries<any>(query as any)) {
                    const val = additionalMeta[k];
                    if (val === undefined || v === undefined) {
                        continue outerLoop;
                    }
                    if (Array.isArray(val)) {
                        if (Array.isArray(v)) {
                            if (_.intersection(val, v).length === 0) {
                                continue outerLoop;
                            }
                            break;
                        }
                        if (!val.includes(v)) {
                            continue outerLoop;
                        }

                        break;
                    }
                    if (Array.isArray(v)) {
                        if (!v.includes(val)) {
                            continue outerLoop;
                        }
                        break;
                    } else if (`${val}` !== v) {
                        continue outerLoop;
                    }
                }
            }
            const operationObject = this.createOperationObject(rpcOptions, envelopeClass);
            if (!paths[path]) {
                paths[path] = {};
            }

            const pathVariables = path.matchAll(/{([^}]+)}/g);
            for (const pathVar of pathVariables) {
                const pathVarName = pathVar[1];
                if (!operationObject.parameters) {
                    operationObject.parameters = {};
                }
                if (!operationObject.parameters[pathVarName]) {
                    operationObject.parameters[pathVarName] = {
                        name: pathVarName,
                        in: 'path',
                        required: true
                    };
                }
                operationObject.parameters[pathVarName] = {
                    name: pathVarName,
                    ...operationObject.parameters[pathVarName],
                    in: 'path',
                    required: true
                };
            }

            const obj = {
                ...operationObject,
                parameters: Object.entries<object>(operationObject.parameters)
                    .map(([k, v]) => ({ name: k, ...v }))
            };
            if (['get', 'delete', 'head', 'options'].includes(lowerMethod)) {
                delete obj.requestBody;
            }

            paths[path][lowerMethod] = obj;
        }

        return paths;
    }

    protected createComponentsObject() {
        const schemas: any = {};

        for (const [k, v] of this.classToSchemaMapInput.entries()) {
            const schema = _.cloneDeep(v);
            this.consumeIncompatibles(schema);
            schemas[this.getRefNameOfConstructor(k, 'input')] = schema;
        }
        for (const [k, v] of this.classToSchemaMapOutput.entries()) {
            const schema = _.cloneDeep(v);
            this.consumeIncompatibles(schema);
            schemas[this.getRefNameOfConstructor(k, 'output')] = schema;
        }

        return {
            schemas
        };
    }

    createOpenAPIObject(
        baseUri: string,
        additionalConfig: any,
        envelopeClass: typeof RPCEnvelope,
        query?: {
            [k: string]: string | string[] | undefined;
        }
    ) {
        const final: any = {
            openapi: '3.0.0',
            info: {
                title: `${process.env.npm_package_name || this.constructor.name} OpenAPI`,
                version: `${process.env.npm_package_version || 'N/A'}`,
            },
            servers: [
                {
                    url: baseUri
                }
            ],
            paths: this.createPathsObject(envelopeClass, query),
            components: this.createComponentsObject(),

        };

        _.merge(final, additionalConfig);


        return final;
    }
}
