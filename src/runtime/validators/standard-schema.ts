import {
  isObjectLike,
  normalizeStandardSchemaResult,
  type InferOutput,
  type StandardSchemaLike,
  type ValidationResult,
} from './common'

export function isStandardSchema(schema: unknown): schema is StandardSchemaLike {
  const standard = isObjectLike(schema)
    ? (schema as { readonly '~standard'?: { readonly validate?: unknown } })['~standard']
    : undefined

  return isObjectLike(schema) && '~standard' in schema && typeof standard?.validate === 'function'
}

export async function parseStandardSchema<SCHEMA extends StandardSchemaLike>(
  schema: SCHEMA,
  input: unknown,
): Promise<ValidationResult<InferOutput<SCHEMA>>> {
  return normalizeStandardSchemaResult(
    await schema['~standard'].validate(input),
  ) as ValidationResult<InferOutput<SCHEMA>>
}
