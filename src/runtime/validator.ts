import {
  effectSchemaToJsonSchema,
  isEffectSchemaLike,
  parseEffectSchema,
} from './validators/effect-schema'
import { getProvidedJsonSchema } from './validators/json-schema-provider'
import { isStandardSchema, parseStandardSchema } from './validators/standard-schema'
import {
  isValibotOptionalSchema,
  isValibotSchemaLike,
  valibotToJsonSchema,
} from './validators/valibot'
import {
  isZodOptionalSchema,
  isZodV4SchemaLike,
  parseZodLike,
  zodV4ToOpenApiSchema,
} from './validators/zod'
import {
  isObjectLike,
  type InferOutput,
  type JsonSchema,
  type JsonSchemaComponents,
  type JsonSchemaConversionContext,
  type JsonSchemaConversionOptions,
  type ValidationResult,
  type ValidatorSchema,
} from './validators/common'

export type {
  EffectSchemaLike,
  InferInput,
  InferOutput,
  JsonSchema,
  JsonSchemaComponents,
  JsonSchemaConversionContext,
  JsonSchemaConversionMode,
  JsonSchemaConversionOptions,
  JsonSchemaPrimitive,
  JsonSchemaValue,
  StandardSchemaLike,
  ValidationIssue,
  ValidationPathSegment,
  ValidationResult,
  ValidatorSchema,
  ZodLike,
} from './validators/common'

export async function parseValidator<SCHEMA extends ValidatorSchema>(
  schema: SCHEMA,
  input: unknown,
): Promise<ValidationResult<InferOutput<SCHEMA>>> {
  if (isStandardSchema(schema)) {
    return parseStandardSchema(schema, input)
  }

  if (isEffectSchemaLike(schema)) {
    return parseEffectSchema(schema, input)
  }

  return parseZodLike(schema, input) as Promise<ValidationResult<InferOutput<SCHEMA>>>
}

export function createJsonSchemaContext(): JsonSchemaConversionContext {
  return { components: { schemas: {} } }
}

export function getJsonSchemaComponents(
  context: JsonSchemaConversionContext,
): JsonSchemaComponents | undefined {
  const schemas = context.components?.schemas
  if (!schemas || Object.keys(schemas).length === 0) {
    return undefined
  }
  return { schemas }
}

export function toJsonSchema(
  schema: unknown,
  context: JsonSchemaConversionContext = {},
  options: JsonSchemaConversionOptions = {},
): JsonSchema {
  if (!isObjectLike(schema)) {
    return {}
  }

  if (isZodV4SchemaLike(schema)) {
    return zodV4ToOpenApiSchema(schema, context, options.mode || 'output')
  }

  if (isValibotSchemaLike(schema)) {
    return valibotToJsonSchema(schema, options.mode || 'output')
  }

  if (isEffectSchemaLike(schema)) {
    return effectSchemaToJsonSchema(schema)
  }

  return getProvidedJsonSchema(schema) || {}
}

export function inspectJsonSchemaObject(
  schema: JsonSchema,
  components: JsonSchemaComponents = {},
): {
  inspectable: boolean
  properties: Record<string, JsonSchema>
  required: string[]
} {
  const componentsByName = components.schemas ?? {}
  const { inspectable, properties } = collectJsonSchemaObjectProperties(schema, componentsByName)

  return {
    inspectable,
    properties,
    required: [...collectRequiredJsonSchemaProperties(schema, componentsByName)],
  }
}

export function inspectValidatorInputObject(schema: unknown) {
  const context = createJsonSchemaContext()
  const converted = toJsonSchema(schema, context, { mode: 'input' })
  return inspectJsonSchemaObject(converted, getJsonSchemaComponents(context))
}

export function inspectValidatorOutputObject(schema: unknown) {
  const context = createJsonSchemaContext()
  const converted = toJsonSchema(schema, context, { mode: 'output' })
  return inspectJsonSchemaObject(converted, getJsonSchemaComponents(context))
}

function collectJsonSchemaObjectProperties(
  schema: JsonSchema,
  components: Record<string, JsonSchema>,
  seenReferences = new Set<string>(),
): { inspectable: boolean; properties: Record<string, JsonSchema> } {
  if (typeof schema !== 'object' || schema === null) {
    return { inspectable: false, properties: {} }
  }

  const properties: Record<string, JsonSchema> = {}
  let inspectable = false

  if (
    'properties' in schema &&
    typeof schema.properties === 'object' &&
    schema.properties !== null &&
    !Array.isArray(schema.properties)
  ) {
    inspectable = true
    for (const [name, value] of Object.entries(schema.properties)) {
      if (isJsonSchema(value)) {
        properties[name] = value
      }
    }
  }

  if (typeof schema.$ref === 'string') {
    const prefix = '#/components/schemas/'
    if (schema.$ref.startsWith(prefix) && !seenReferences.has(schema.$ref)) {
      const componentName = schema.$ref
        .slice(prefix.length)
        .replaceAll('~1', '/')
        .replaceAll('~0', '~')
      const component = components[componentName]
      if (component) {
        const referenced = collectJsonSchemaObjectProperties(
          component,
          components,
          new Set(seenReferences).add(schema.$ref),
        )
        inspectable ||= referenced.inspectable
        mergePropertyConstraints(properties, referenced.properties)
      }
    }
  }

  for (const branch of jsonSchemaArray(schema.allOf)) {
    const inspected = collectJsonSchemaObjectProperties(branch, components, new Set(seenReferences))
    inspectable ||= inspected.inspectable
    mergePropertyConstraints(properties, inspected.properties)
  }

  for (const keyword of ['anyOf', 'oneOf'] as const) {
    const alternatives = jsonSchemaArray(schema[keyword]).map((branch) =>
      collectJsonSchemaObjectProperties(branch, components, new Set(seenReferences)),
    )
    inspectable ||= alternatives.some((alternative) => alternative.inspectable)

    const names = new Set(
      alternatives.flatMap((alternative) => Object.keys(alternative.properties)),
    )
    for (const name of names) {
      const schemas = alternatives.flatMap((alternative) => {
        const property = alternative.properties[name]
        return property === undefined ? [] : [property]
      })
      if (schemas.length > 0) {
        mergePropertyConstraint(
          properties,
          name,
          schemas.length === 1 ? schemas[0] : { [keyword]: schemas },
        )
      }
    }
  }

  return { inspectable, properties }
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return (
    typeof value === 'boolean' ||
    (typeof value === 'object' && value !== null && !Array.isArray(value))
  )
}

function mergePropertyConstraints(
  target: Record<string, JsonSchema>,
  source: Record<string, JsonSchema>,
): void {
  for (const [name, schema] of Object.entries(source)) {
    mergePropertyConstraint(target, name, schema)
  }
}

function mergePropertyConstraint(
  target: Record<string, JsonSchema>,
  name: string,
  schema: JsonSchema,
): void {
  const existing = target[name]
  target[name] = existing === undefined ? schema : { allOf: [existing, schema] }
}

function collectRequiredJsonSchemaProperties(
  schema: JsonSchema,
  components: Record<string, JsonSchema>,
  seenReferences = new Set<string>(),
): Set<string> {
  if (typeof schema !== 'object' || schema === null) {
    return new Set()
  }

  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((name): name is string => typeof name === 'string')
      : [],
  )

  if (typeof schema.$ref === 'string') {
    const prefix = '#/components/schemas/'
    if (schema.$ref.startsWith(prefix) && !seenReferences.has(schema.$ref)) {
      const componentName = schema.$ref
        .slice(prefix.length)
        .replaceAll('~1', '/')
        .replaceAll('~0', '~')
      const component = components[componentName]
      if (component) {
        const nextSeen = new Set(seenReferences).add(schema.$ref)
        addSet(required, collectRequiredJsonSchemaProperties(component, components, nextSeen))
      }
    }
  }

  const allOf = jsonSchemaArray(schema.allOf)
  for (const branch of allOf) {
    addSet(
      required,
      collectRequiredJsonSchemaProperties(branch, components, new Set(seenReferences)),
    )
  }

  for (const keyword of ['anyOf', 'oneOf'] as const) {
    const alternatives = jsonSchemaArray(schema[keyword])
    if (alternatives.length === 0) {
      continue
    }
    const common = alternatives
      .map((branch) =>
        collectRequiredJsonSchemaProperties(branch, components, new Set(seenReferences)),
      )
      .reduce(intersectSets)
    addSet(required, common)
  }

  return required
}

function jsonSchemaArray(value: unknown): JsonSchema[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(
    (item): item is JsonSchema =>
      typeof item === 'boolean' ||
      (typeof item === 'object' && item !== null && !Array.isArray(item)),
  )
}

function addSet(target: Set<string>, source: Set<string>): void {
  for (const value of source) {
    target.add(value)
  }
}

function intersectSets(left: Set<string>, right: Set<string>): Set<string> {
  return new Set([...left].filter((value) => right.has(value)))
}

export function isOptionalSchema(schema: unknown): boolean {
  return isZodOptionalSchema(schema) || isValibotOptionalSchema(schema)
}
