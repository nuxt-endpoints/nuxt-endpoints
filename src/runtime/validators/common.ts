export type ValidationIssue = {
  path?: readonly ValidationPathSegment[]
  message: string
  code?: string
}

export type ValidationPathSegment = string | number | symbol | { readonly key: unknown }

export type JsonSchemaPrimitive = string | number | boolean | null

export type JsonSchemaValue =
  | JsonSchema
  | JsonSchemaPrimitive
  | readonly JsonSchemaValue[]
  | undefined

export type JsonSchema =
  | boolean
  | {
      [key: string]: JsonSchemaValue
    }

export type JsonSchemaComponents = {
  schemas?: Record<string, JsonSchema>
}

export type JsonSchemaConversionMode = 'input' | 'output'

export type JsonSchemaConversionOptions = {
  mode?: JsonSchemaConversionMode
}

export type JsonSchemaConversionContext = {
  components?: JsonSchemaComponents
}

export type ValidationResult<OUTPUT> =
  | { success: true; value: OUTPUT }
  | { success: false; issues: readonly ValidationIssue[] }

export type StandardSchemaResult<OUTPUT> =
  | { value: OUTPUT; issues?: undefined }
  | { value?: undefined; issues: readonly ValidationIssue[] }

export type StandardSchemaLike<INPUT = unknown, OUTPUT = INPUT> = {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      input: unknown,
    ) => StandardSchemaResult<OUTPUT> | Promise<StandardSchemaResult<OUTPUT>>
    readonly types?: {
      readonly input: INPUT
      readonly output: OUTPUT
    }
  }
}

export type SafeParseResult<OUTPUT> =
  | { success: true; data: OUTPUT }
  | {
      success: false
      error: { issues?: readonly ValidationIssue[]; errors?: readonly ValidationIssue[] }
    }

export type ZodLike<INPUT = unknown, OUTPUT = INPUT> = {
  readonly _input?: INPUT
  readonly _output?: OUTPUT
  parse?: (input: unknown) => OUTPUT
  parseAsync?: (input: unknown) => Promise<OUTPUT>
  safeParse?: (input: unknown) => SafeParseResult<OUTPUT>
  safeParseAsync?: (input: unknown) => Promise<SafeParseResult<OUTPUT>>
}

export type EffectSchemaLike<INPUT = unknown, OUTPUT = INPUT> = {
  readonly Type: OUTPUT
  readonly Encoded: INPUT
  readonly Context: never
  readonly ast: unknown
}

export type ValidatorSchema<INPUT = unknown, OUTPUT = INPUT> =
  | StandardSchemaLike<INPUT, OUTPUT>
  | EffectSchemaLike<INPUT, OUTPUT>
  | ZodLike<INPUT, OUTPUT>

export type InferInput<SCHEMA> = SCHEMA extends {
  readonly '~standard': { readonly types?: { readonly input: infer INPUT } }
}
  ? INPUT
  : SCHEMA extends EffectSchemaLike<infer INPUT, unknown>
    ? INPUT
    : SCHEMA extends { readonly _input?: infer INPUT }
      ? INPUT
      : unknown

export type InferOutput<SCHEMA> = SCHEMA extends {
  readonly '~standard': { readonly types?: { readonly output: infer OUTPUT } }
}
  ? OUTPUT
  : SCHEMA extends EffectSchemaLike<unknown, infer OUTPUT>
    ? OUTPUT
    : SCHEMA extends { readonly _output?: infer OUTPUT }
      ? OUTPUT
      : unknown

export type JsonSchemaObject = Exclude<JsonSchema, boolean>

export function normalizeStandardSchemaResult<OUTPUT>(
  result: StandardSchemaResult<OUTPUT>,
): ValidationResult<OUTPUT> {
  if (result.issues?.length) {
    return { success: false, issues: [...result.issues] }
  }
  return { success: true, value: result.value as OUTPUT }
}

export function stripRootJsonSchemaDialect(schema: JsonSchema): JsonSchema {
  if (!isJsonSchemaObject(schema) || !('$schema' in schema)) {
    return schema
  }

  const result = { ...schema }
  delete result.$schema
  return result
}

export function isJsonSchema(value: unknown): value is JsonSchema {
  return typeof value === 'boolean' || isJsonSchemaObject(value as JsonSchema)
}

export function isJsonSchemaObject(schema: JsonSchema): schema is JsonSchemaObject {
  return typeof schema === 'object' && schema !== null && !Array.isArray(schema)
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isObjectLike(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}
