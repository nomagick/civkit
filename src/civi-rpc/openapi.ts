import _ from 'lodash';
import { Readable } from 'stream';
import { inspect } from 'util';
import {
    AdditionalPropOptions, AutoCastable,
    AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL, AUTOCASTABLE_OPTIONS_SYMBOL,
    PropOptions
} from '../lib/auto-castable';
import { chainEntries, isConstructor } from '../utils';
import { PICK_RPC_PARAM_DECORATION_META_KEY, RPCOptions } from './registry';

type PropOptionsLike = Partial<PropOptions<any>> & Partial<RPCOptions>;

export class OpenAPIManager {

    classToSchemaMapInput = new Map<any, any>();
    classToSchemaMapOutput = new Map<any, any>();
    refToConstructorMap = new Map<string, any>();
    pathToRPCOptionsMap = new Map<string, [string, string, RPCOptions, { [k: string]: any; }]>();

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
            'responseBodyContentType',
        ],
        incompatibleProp: [
            'incompatibles',
            'partOf',
            'primitive'
        ]
    };

    applySceneMeta(schema: any, meta: PropOptionsLike, scene?: string | string[]) {
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


    applyMeta(schema: any, meta: PropOptionsLike, special?: string | string[]) {
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
        if (meta.partOf) {
            incompatibleMeta.partOf = meta.partOf;
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

    consumeIncompatibles(schema: any) {
        if (!schema.incompatibles) {
            return;
        }
        const descVecs: string[] = [];
        const incompatibles: PropOptionsLike = schema.incompatibles;

        if (schema.deprecated || incompatibles.deprecated) {
            descVecs.push(`[DEPRECATED]`);
        }

        if (schema.required || incompatibles.required) {
            descVecs.push(`[REQUIRED]`);
        }
        if (schema.description) {
            descVecs.push(schema.description);
        }
        if (incompatibles.partOf) {
            descVecs.push(`- Member of {${incompatibles.partOf}}.`);
        }

        if (incompatibles.validate) {
            const validatorNames = (Array.isArray(incompatibles.validate) ?
                incompatibles.validate : [incompatibles.validate]).map((x) => x.name).filter(Boolean);

            descVecs.push(`- Some validators will be applied on value(s): ${validatorNames}`);
        }

        if (incompatibles.validateCollection) {
            const validatorNames = (Array.isArray(incompatibles.validateCollection) ?
                incompatibles.validateCollection : [incompatibles.validateCollection])
                .map((x) => x.name).filter(Boolean);

            descVecs.push(`- Some validators will be applied on the collection: ${validatorNames}`);
        }

        if (incompatibles.default) {
            descVecs.push(`- Defaults to: ${inspect(incompatibles.default, { depth: 6 })}`);
        }
        if (incompatibles.defaultFactory) {
            if (incompatibles.defaultFactory.name) {
                descVecs.push(`- A dynamic default value will be provided on server side based on: ${incompatibles.defaultFactory.name}`);
            } else {
                descVecs.push(`- A dynamic default value will be provided on server side`);
            }
        }

        schema.description = descVecs.join('\n\n');

        for (const prop of this.predefined.incompatibleProp) {
            delete schema[prop];
        }

        if (typeof schema.required === 'boolean' && !schema.in) {
            delete schema.required;
        }
    }

    getRefNameOfConstructor(inputClass: any, direction: 'input' | 'output' = 'input') {
        let name: string;
        switch (inputClass) {
            case undefined: {
                name = 'undefined';
                break;
            }
            case null: {
                name = 'null';
                break;
            }

            default: {
                name = inputClass.name || inputClass.constructor.name;
                break;
            }
        }

        if (inputClass?.prototype instanceof AutoCastable) {
            const propOptions = inputClass.prototype[AUTOCASTABLE_OPTIONS_SYMBOL];
            for (const [k, v] of chainEntries(propOptions) as [string, PropOptions<unknown>][]) {
                if (v.path !== k) {
                    return direction === 'input' ? `${name}-dto` : name;
                }
            }
        }

        return name;
    }

    getSchemaRef(inputClass: any = Object, direction: 'input' | 'output' = 'input') {
        if (this.primitiveSchemaMap.has(inputClass)) {
            return {
                ...this.primitiveSchemaMap.get(inputClass)
            };
        } else if (inputClass instanceof Set) {
            return this.constructorToOpenAPISchema(inputClass, direction);
        }
        if (!isConstructor(inputClass)) {
            return undefined;
        }
        const theMap = direction === 'input' ? this.classToSchemaMapInput : this.classToSchemaMapOutput;
        if (!theMap.has(inputClass)) {
            const schema = this.constructorToOpenAPISchema(inputClass, direction);
            if (this.primitiveSchemaMap.has(inputClass)) {
                return {
                    ...this.primitiveSchemaMap.get(inputClass)
                };
            }
            theMap.set(inputClass, schema);
        }

        const refVal = `#/components/schemas/${this.getRefNameOfConstructor(inputClass, direction)}`;
        this.refToConstructorMap.set(refVal, inputClass);

        return { $ref: refVal };
    }

    getConstructorFromRef(ref: string) {
        return this.refToConstructorMap.get(ref);
    }

    unref(ref: string, direction: 'input' | 'output' = 'input') {
        const constructor = this.getConstructorFromRef(ref);
        if (constructor) {
            return this.constructorToOpenAPISchema(constructor, direction);
        }
        return undefined;
    }

    unRefSchema(schema: any, direction: 'input' | 'output' = 'input') {
        if (schema?.$ref) {
            return { ...schema, ...this.unref(schema.$ref, direction), $ref: undefined };
        }

        return schema;
    }

    flattenSchema(inputSchema: any) {
        if (!inputSchema) {
            return undefined;
        }

        let schema = this.unRefSchema(inputSchema);

        let schemaModified = false;

        if (schema.type === 'array') {
            const origSchema = schema;
            schema = {
                ..._.omit(schema, 'type', 'items', 'default'),
                ...this.unRefSchema(schema.items),
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

    constructorToOpenAPISchema(input: any = Object, direction: 'input' | 'output' = 'input') {
        let final: any = undefined;

        let additionalOptionsApplied = false;
        let shouldAddToPrimitives = false;
        do {
            if (input?.prototype instanceof AutoCastable) {
                const propOptions = input.prototype[AUTOCASTABLE_OPTIONS_SYMBOL];
                const properties: { [k: string]: any; } = {};
                const requiredProperties: string[] = [];
                for (const [k, v] of chainEntries(propOptions) as [string, PropOptions<unknown>][]) {
                    const prop = direction === input ? v.path : k;
                    if (typeof prop !== 'string') {
                        continue;
                    }
                    properties[prop] = this.propOptionsLikeToOpenAPISchema(v, direction, true);

                    if (properties[prop]) {
                        this.applyMeta(properties[prop], {
                            ...v,
                            partOf: input.name
                        }, ['property', 'schema']);
                    } else {
                        delete properties[prop];
                    }
                }

                const additionalOptions: AdditionalPropOptions<unknown> | undefined =
                    input.prototype[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL];
                const openAPIDesc: any = {
                    type: 'object',
                    properties,
                    required: requiredProperties
                };

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

                if (additionalOptions?.dictOf) {
                    const dictSchema = this.propOptionsLikeToOpenAPISchema(
                        { dictOf: additionalOptions.dictOf }, direction, true
                    );
                    if (dictSchema.additionalProperties) {
                        openAPIDesc.additionalProperties = dictSchema.additionalProperties;
                    }
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
                final = { type: 'string', format: 'binary' };
                break;
            } else if (input instanceof Set) {
                // enum
                const values = Array.from(input);
                if (typeof values[0] === 'string') {
                    final = { type: 'string', enum: Array.from(input) };
                } else if (Number.isInteger(values[0])) {
                    final = { type: 'integer', enum: Array.from(input) };
                }

                final = { type: 'string' };
                break;
            } else if (this.primitiveSchemaMap.has(input)) {
                final = { ...this.primitiveSchemaMap.get(input) };
                break;
            } else if (isConstructor(input)) {
                final = { type: 'string', format: input.name };
                shouldAddToPrimitives = true;
                break;
            }
        } while (false);

        if (!additionalOptionsApplied && input?.prototype) {
            const additionalOptions: AdditionalPropOptions<unknown> | undefined =
                input.prototype[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL];

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

    autoTypesToOpenAPISchema(
        input: any | any[] = Object,
        direction: 'input' | 'output' = 'input',
        useRef: boolean = true
    ) {
        if (Array.isArray(input)) {

            const schemas = input.map((x) => useRef ?
                this.getSchemaRef(x, direction) :
                this.constructorToOpenAPISchema(x, direction)
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
            this.constructorToOpenAPISchema(input, direction);
    }

    autoCollectMetaFromTypes(
        input: any | any[] = Object,
        scene?: string | string[]
    ) {
        const final: any = {};
        if (Array.isArray(input)) {
            for (const x of input) {
                const additionalOptions: AdditionalPropOptions<unknown> | undefined =
                    x?.prototype?.[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL];

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

        const additionalOptions: AdditionalPropOptions<unknown> | undefined =
            input?.prototype?.[AUTOCASTABLE_ADDITIONAL_OPTIONS_SYMBOL];

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
        }

        return final;
    }

    collectOperationMeta(
        conf: PropOptionsLike
    ): any {
        const final: any = {};

        if (conf.paramTypes) {
            const paramPickerMeta = Reflect.getMetadata(PICK_RPC_PARAM_DECORATION_META_KEY, conf.hostProto);
            const paramPickerConf = (paramPickerMeta?.[conf.nameOnProto]) || [];

            if (Array.isArray(conf.paramTypes)) {
                for (const [i, x] of conf.paramTypes.entries()) {
                    const conf2 = { type: x, ...paramPickerConf[i] };
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


    getShallowPropertiesFromFullSchema(inputSchema: any) {
        const parameters: any = {};
        if (inputSchema.$ref) {
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

    createParameterObject(rpcOptions: RPCOptions) {
        const properties: any = {};

        const paramPickerMeta = Reflect.getMetadata(PICK_RPC_PARAM_DECORATION_META_KEY, rpcOptions.hostProto);
        const paramPickerConf = (paramPickerMeta ? paramPickerMeta[rpcOptions.nameOnProto] : undefined) || [];

        if (Array.isArray(rpcOptions.paramTypes)) {
            for (const [i, x] of rpcOptions.paramTypes.entries()) {
                const conf = { type: x, ...paramPickerConf[i] } as PropOptions<unknown>;
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

    createRequestBodyObject(rpcOptions: RPCOptions) {
        const paramPickerMeta = Reflect.getMetadata(PICK_RPC_PARAM_DECORATION_META_KEY, rpcOptions.hostProto);
        const paramPickerConf = (paramPickerMeta ? paramPickerMeta[rpcOptions.nameOnProto] : undefined) || [];

        let openAPISchemas: any[] = [];
        const shallowObj: any = {};
        const nonDtoParams: any = {};
        const nonDtoParamsRequired: string[] = [];

        const recursiveDetector = new Set<string>();

        if (Array.isArray(rpcOptions.paramTypes)) {
            for (const [i, x] of rpcOptions.paramTypes.entries()) {
                const conf = { type: x, ...paramPickerConf[i] } as PropOptions<unknown>;

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

            if (v.$ref) {
                recursiveDetector.add(v.$ref);
            }

            this.consumeIncompatibles(v);
        }

        for (const [k, v] of Object.entries<any>(nonDtoParams)) {
            if (v.omitted) {
                delete nonDtoParams[k];
                continue;
            }

            if (v.$ref) {
                recursiveDetector.add(v.$ref);
            }

            this.consumeIncompatibles(v);
        }

        const rpcOpenAPIConfig = rpcOptions.ext?.openapi || rpcOptions.openapi;
        const requestBodyContentType = rpcOpenAPIConfig?.requestBodyContentType;

        openAPISchemas = openAPISchemas.map((x) => {
            if (!(x?.$ref)) {
                return x;
            }

            if (recursiveDetector.has(x.$ref)) {
                return this.unRefSchema(x);
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

    createResponsesObject(rpcOptions: RPCOptions) {
        const openAPISchema = this.propOptionsLikeToOpenAPISchema(rpcOptions, 'output');
        let metaSchema: any = undefined;
        if (rpcOptions.returnMetaType) {
            metaSchema = this.propOptionsLikeToOpenAPISchema({ returnType: rpcOptions.returnMetaType }, 'output');
            if (metaSchema.oneOf) {
                metaSchema.allOf = metaSchema.oneOf;
                delete metaSchema.oneOf;
            }
            this.consumeIncompatibles(metaSchema);
        }

        this.applySceneMeta(openAPISchema, rpcOptions, 'response');
        this.consumeIncompatibles(openAPISchema);

        const rpcOpenAPIConfig = rpcOptions.ext?.openapi || rpcOptions.openapi;
        const responseBodyContentType = rpcOpenAPIConfig?.responseBodyContentType;

        let contentType = responseBodyContentType || 'application/json';
        const unRefedSchema = this.unRefSchema(openAPISchema);
        if (unRefedSchema?.type === 'string') {
            if (unRefedSchema.format === 'stream' || unRefedSchema.format === 'binary') {
                contentType = responseBodyContentType || 'application/octet-stream';
            }
        }

        const contentObj = contentType === 'application/json' ? {
            'application/json': {
                schema: {
                    type: 'object',
                    properties: {
                        code: {
                            type: 'integer'
                        },
                        status: {
                            type: 'integer'
                        },
                        data: openAPISchema,
                        meta: metaSchema
                    }
                }
            }
        } : {
            [contentType]: {
                schema: openAPISchema
            }
        };

        return {
            '200': {
                description: 'OK',
                content: contentObj
            },
            default: {
                description: 'In case of error',
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: {
                                code: {
                                    type: 'integer'
                                },
                                status: {
                                    type: 'integer'
                                },
                                message: {
                                    type: 'string'
                                }
                            },
                            additionalProperties: true
                        }
                    }
                }
            }
        };
    }

    createOperationObject(rpcOptions: RPCOptions) {
        const parametersObject = this.createParameterObject(rpcOptions);

        for (const x of Object.values<any>(parametersObject)) {
            if (x?.schema) {
                this.consumeIncompatibles(x.schema);
            }
            this.consumeIncompatibles(x);
        }

        const requestBodyObject = this.createRequestBodyObject(rpcOptions);
        const responsesObject = this.createResponsesObject(rpcOptions);
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
        rpcOptions: RPCOptions,
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
                            ...(rpcOptions.tags || rpcOptions.ext?.openapi?.tags || rpcOptions.openapi?.tags || []),
                            ...(additionalMeta.tags || [])
                        ].map((x) => x.toString().toLowerCase())),
                    }
                ]
            );
        }
    }

    createPathsObject(query?: {
        [k: string]: string | string[] | undefined;
    }) {
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
            const operationObject = this.createOperationObject(rpcOptions);
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

    createComponentsObject() {
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
            paths: this.createPathsObject(query),
            components: this.createComponentsObject(),

        };

        _.merge(final, additionalConfig);


        return final;
    }
}
