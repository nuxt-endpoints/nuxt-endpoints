import { OpenApiGeneratorV31, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import {
  isJsonSchema,
  isObject,
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
  const path = '/__endpoints_schema'
  const registry = new OpenAPIRegistry()
  registry.registerPath({
    method: 'get',
    path,
    responses: {
      200: {
        description: 'Schema',
        content: {
          'application/json': {
            schema: schema as never,
          },
        },
      },
    },
  })

  const document = new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'Endpoint Schema', version: '0.1.0' },
  })

  mergeGeneratedComponents(context, document.components)

  const pathItem = document.paths?.[path]
  const operation = isObject(pathItem?.get) ? pathItem.get : {}
  const responses = isObject(operation.responses) ? operation.responses : {}
  const response = responses[200] || responses['200']
  const content = isObject(response) && isObject(response.content) ? response.content : {}
  const media = isObject(content['application/json']) ? content['application/json'] : {}
  return isJsonSchema(media.schema) ? media.schema : {}
}

function mergeGeneratedComponents(context: JsonSchemaConversionContext, components: unknown): void {
  if (!isObject(components) || !isObject(components.schemas)) {
    return
  }

  context.components ||= {}
  context.components.schemas ||= {}

  for (const [name, schema] of Object.entries(components.schemas)) {
    if (isJsonSchema(schema)) {
      context.components.schemas[name] = schema
    }
  }
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
