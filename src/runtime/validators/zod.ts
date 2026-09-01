import {
  isJsonSchema,
  isObject,
  stripRootJsonSchemaDialect,
  type InferOutput,
  type JsonSchema,
  type JsonSchemaConversionContext,
  type SafeParseResult,
  type ValidationIssue,
  type ValidationResult,
  type ZodLike,
} from './common'

export type ZodV4SchemaLike = ZodLike & {
  readonly _zod?: {
    readonly def?: {
      readonly type?: string
    }
  }
  readonly description?: string
  isOptional?: () => boolean
  meta?: () => unknown
  toJSONSchema?: (options: {
    unrepresentable: 'any'
    override: (context: { zodSchema: ZodV4SchemaLike; jsonSchema: Record<string, unknown> }) => void
  }) => unknown
}

export function isZodV4SchemaLike(schema: unknown): schema is ZodV4SchemaLike {
  return (
    isObject(schema) &&
    isObject(schema._zod) &&
    isObject(schema._zod.def) &&
    typeof schema._zod.def.type === 'string' &&
    typeof schema.safeParse === 'function'
  )
}

export function isZodOptionalSchema(schema: unknown): boolean {
  return (
    isObject(schema) &&
    typeof (schema as ZodV4SchemaLike).isOptional === 'function' &&
    Boolean((schema as ZodV4SchemaLike).isOptional?.())
  )
}

export async function parseZodLike<SCHEMA extends ZodLike>(
  schema: SCHEMA,
  input: unknown,
): Promise<ValidationResult<InferOutput<SCHEMA>>> {
  if (schema.safeParseAsync) {
    return normalizeSafeParseResult(await schema.safeParseAsync(input)) as ValidationResult<
      InferOutput<SCHEMA>
    >
  }

  if (schema.safeParse) {
    return normalizeSafeParseResult(schema.safeParse(input)) as ValidationResult<
      InferOutput<SCHEMA>
    >
  }

  try {
    if (schema.parseAsync) {
      return { success: true, value: (await schema.parseAsync(input)) as InferOutput<SCHEMA> }
    }
    if (schema.parse) {
      return { success: true, value: schema.parse(input) as InferOutput<SCHEMA> }
    }
  } catch (error) {
    return { success: false, issues: normalizeThrownIssues(error) }
  }

  return {
    success: false,
    issues: [{ message: 'Unsupported validator schema' }],
  }
}

export function zodV4ToOpenApiSchema(
  schema: ZodV4SchemaLike,
  context: JsonSchemaConversionContext,
): JsonSchema {
  if (typeof schema.toJSONSchema !== 'function') {
    throw new Error(
      'Zod JSON Schema conversion requires a classic Zod schema from zod 4.2 or newer.',
    )
  }

  const converted = schema.toJSONSchema({
    unrepresentable: 'any',
    override({ zodSchema, jsonSchema }) {
      if (zodSchema._zod?.def?.type === 'date') {
        Object.assign(jsonSchema, { type: 'string', format: 'date-time' })
      }
    },
  })

  if (!isJsonSchema(converted)) {
    return {}
  }

  const metadata = schema.meta?.()
  const componentName =
    isObject(metadata) && typeof metadata.id === 'string' ? metadata.id : undefined
  return normalizeZodJsonSchema(converted, context, componentName)
}

function normalizeZodJsonSchema(
  converted: JsonSchema,
  context: JsonSchemaConversionContext,
  componentName: string | undefined,
): JsonSchema {
  const withoutDialect = stripRootJsonSchemaDialect(converted)
  if (!isObject(withoutDialect)) {
    return withoutDialect
  }

  const definitions = isObject(withoutDialect.$defs)
    ? withoutDialect.$defs
    : isObject(withoutDialect.definitions)
      ? withoutDialect.definitions
      : undefined
  const root = { ...withoutDialect }
  delete root.$defs
  delete root.definitions

  context.components ||= {}
  context.components.schemas ||= {}

  if (definitions) {
    for (const [name, definition] of Object.entries(definitions)) {
      if (isJsonSchema(definition)) {
        context.components.schemas[name] = rewriteZodReferences(definition)
      }
    }
  }

  const normalizedRoot = rewriteZodReferences(root, componentName)
  if (!componentName) {
    return normalizedRoot
  }

  context.components.schemas[componentName] = normalizedRoot
  return { $ref: componentReference(componentName) }
}

function rewriteZodReferences(schema: JsonSchema, rootComponentName?: string): JsonSchema {
  return rewriteValue(schema, rootComponentName) as JsonSchema
}

function rewriteValue(value: unknown, rootComponentName?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteValue(item, rootComponentName))
  }
  if (!isObject(value)) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (key === '$ref' && typeof item === 'string') {
        if (item === '#' && rootComponentName) {
          return [key, componentReference(rootComponentName)]
        }
        if (item.startsWith('#/$defs/')) {
          return [key, `#/components/schemas/${item.slice('#/$defs/'.length)}`]
        }
        if (item.startsWith('#/definitions/')) {
          return [key, `#/components/schemas/${item.slice('#/definitions/'.length)}`]
        }
      }
      return [key, rewriteValue(item, rootComponentName)]
    }),
  )
}

function componentReference(name: string): string {
  return `#/components/schemas/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`
}

function normalizeSafeParseResult<OUTPUT>(
  result: SafeParseResult<OUTPUT>,
): ValidationResult<OUTPUT> {
  if (result.success) {
    return { success: true, value: result.data }
  }

  return {
    success: false,
    issues: result.error.issues || result.error.errors || [{ message: 'Validation failed' }],
  }
}

function normalizeThrownIssues(error: unknown): ValidationIssue[] {
  if (
    typeof error === 'object' &&
    error !== null &&
    'issues' in error &&
    Array.isArray(error.issues)
  ) {
    return error.issues as ValidationIssue[]
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'errors' in error &&
    Array.isArray(error.errors)
  ) {
    return error.errors as ValidationIssue[]
  }
  if (error instanceof Error) {
    return [{ message: error.message }]
  }
  return [{ message: 'Validation failed' }]
}
