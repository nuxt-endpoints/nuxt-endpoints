import { toJsonSchema as valibotToJsonSchemaObject } from '@valibot/to-json-schema'
import {
  isJsonSchema,
  isObject,
  stripRootJsonSchemaDialect,
  type JsonSchema,
  type JsonSchemaConversionMode,
  type StandardSchemaLike,
} from './common'

export type ValibotSchemaLike = StandardSchemaLike & {
  readonly kind?: string
  readonly type?: string
}

export function isValibotSchemaLike(schema: unknown): schema is ValibotSchemaLike {
  return (
    isObject(schema) &&
    schema.kind === 'schema' &&
    typeof schema.type === 'string' &&
    isObject(schema['~standard']) &&
    schema['~standard'].vendor === 'valibot'
  )
}

export function isValibotOptionalSchema(schema: unknown): boolean {
  return (
    isValibotSchemaLike(schema) &&
    ['optional', 'exact_optional', 'nullish'].includes(schema.type || '')
  )
}

export function valibotToJsonSchema(
  schema: ValibotSchemaLike,
  mode: JsonSchemaConversionMode,
): JsonSchema {
  const converted = valibotToJsonSchemaObject(schema as never, {
    target: 'draft-2020-12',
    typeMode: mode,
    errorMode: 'throw',
  })

  return isJsonSchema(converted) ? stripRootJsonSchemaDialect(converted) : {}
}
