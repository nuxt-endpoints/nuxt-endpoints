import { createRequire } from 'node:module'
import {
  isJsonSchema,
  isObject,
  isObjectLike,
  normalizeStandardSchemaResult,
  stripRootJsonSchemaDialect,
  type EffectSchemaLike,
  type InferOutput,
  type JsonSchema,
  type StandardSchemaLike,
  type ValidationResult,
} from './common'

type EffectSchemaModule = {
  standardSchemaV1: (schema: unknown) => StandardSchemaLike
}

type EffectJsonSchemaModule = {
  make: (
    schema: EffectSchemaLike,
    options?: { target?: 'jsonSchema7' | 'jsonSchema2019-09' | 'jsonSchema2020-12' | 'openApi3.1' },
  ) => JsonSchema
}

const effectSchemaTypeId = Symbol.for('effect/Schema')
const require = createRequire(import.meta.url)
const effectStandardSchemaCache = new WeakMap<EffectSchemaLike, StandardSchemaLike>()
let effectSchemaModule: EffectSchemaModule | undefined
let effectJsonSchemaModule: EffectJsonSchemaModule | undefined

export function isEffectSchemaLike(schema: unknown): schema is EffectSchemaLike {
  return (
    isObjectLike(schema) &&
    effectSchemaTypeId in schema &&
    isObject((schema as EffectSchemaLike).ast)
  )
}

export async function parseEffectSchema<SCHEMA extends EffectSchemaLike>(
  schema: SCHEMA,
  input: unknown,
): Promise<ValidationResult<InferOutput<SCHEMA>>> {
  return normalizeStandardSchemaResult(
    await (await getEffectStandardSchema(schema))['~standard'].validate(input),
  ) as ValidationResult<InferOutput<SCHEMA>>
}

export function effectSchemaToJsonSchema(schema: EffectSchemaLike): JsonSchema {
  effectJsonSchemaModule ||= require('effect/JSONSchema') as EffectJsonSchemaModule
  const converted = effectJsonSchemaModule.make(schema, { target: 'openApi3.1' })
  return isJsonSchema(converted) ? stripRootJsonSchemaDialect(converted) : {}
}

async function getEffectStandardSchema(schema: EffectSchemaLike): Promise<StandardSchemaLike> {
  const cached = effectStandardSchemaCache.get(schema)
  if (cached) {
    return cached
  }

  effectSchemaModule ||= require('effect/Schema') as EffectSchemaModule
  const standardSchema = effectSchemaModule.standardSchemaV1(schema)
  effectStandardSchemaCache.set(schema, standardSchema)
  return standardSchema
}
