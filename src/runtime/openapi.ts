import type { EndpointDefinition, EndpointResponsesContract, ResponseContract } from './contract'
import { isPathParamSegment, pathParamNames, replacePathParams } from './path-template'
import {
  createJsonSchemaContext,
  getJsonSchemaComponents,
  inspectJsonSchemaObject,
  inspectValidatorInputObject,
  isOptionalSchema,
  toJsonSchema,
} from './validator'
import type { JsonSchema, JsonSchemaConversionContext } from './validator'

export type OpenApiDocument = {
  openapi: '3.1.0'
  info: {
    title: string
    version: string
    [key: string]: unknown
  }
  jsonSchemaDialect?: string
  servers?: OpenApiServer[]
  externalDocs?: OpenApiExternalDocs
  tags?: OpenApiTag[]
  security?: OpenApiSecurityRequirement[]
  components?: OpenApiComponents
  paths: Record<string, Record<string, OpenApiOperation>>
  webhooks?: Record<string, Record<string, OpenApiOperation>>
  [key: string]: unknown
}

export type OpenApiDocumentPatch = {
  info?: Partial<OpenApiDocument['info']>
  components?: OpenApiComponents
  paths?: Record<string, Record<string, Record<string, unknown>>>
  [key: string]: unknown
}

export type OpenApiDocumentOptions = {
  title?: string
  version?: string
  document?: OpenApiDocumentPatch
  extend?: (document: OpenApiDocument) => void
}

type OpenApiServer = {
  url: string
  description?: string
  variables?: Record<string, unknown>
  [key: string]: unknown
}

type OpenApiExternalDocs = {
  url: string
  description?: string
  [key: string]: unknown
}

type OpenApiTag = {
  name: string
  description?: string
  externalDocs?: OpenApiExternalDocs
  [key: string]: unknown
}

type OpenApiSecurityRequirement = Record<string, string[]>

export type OpenApiComponents = {
  schemas?: Record<string, JsonSchema>
  responses?: Record<string, unknown>
  parameters?: Record<string, unknown>
  examples?: Record<string, unknown>
  requestBodies?: Record<string, unknown>
  headers?: Record<string, unknown>
  securitySchemes?: Record<string, unknown>
  links?: Record<string, unknown>
  callbacks?: Record<string, unknown>
  pathItems?: Record<string, unknown>
  [key: string]: unknown
}

type OpenApiOperation = {
  operationId: string
  summary?: string
  description?: string
  tags?: string[]
  externalDocs?: OpenApiExternalDocs
  deprecated?: boolean
  security?: OpenApiSecurityRequirement[]
  servers?: OpenApiServer[]
  parameters?: OpenApiParameter[]
  requestBody?: {
    required?: boolean
    description?: string
    content: Record<string, OpenApiMediaType>
    [key: string]: unknown
  }
  responses: Record<string, OpenApiResponse>
  callbacks?: Record<string, unknown>
  [key: string]: unknown
}

type OpenApiMediaType = {
  schema: JsonSchema
  example?: unknown
  examples?: Record<string, unknown>
  encoding?: Record<string, unknown>
  [key: string]: unknown
}

type OpenApiResponse = {
  description: string
  headers?: Record<
    string,
    {
      schema: JsonSchema
      [key: string]: unknown
    }
  >
  content: {
    [contentType: string]: OpenApiMediaType
  }
  links?: Record<string, unknown>
  [key: string]: unknown
}

export type OpenApiRoute = {
  path: string
  method: string
  definition: EndpointDefinition
}

export function createOpenApiDocument(
  endpoints: OpenApiRoute[],
  options: OpenApiDocumentOptions = {},
): OpenApiDocument {
  const paths: OpenApiDocument['paths'] = {}
  const schemaContext = createJsonSchemaContext()
  const operations = new Set<string>()

  for (const endpoint of endpoints) {
    const operationId = endpoint.definition.operation || fallbackOperationId(endpoint)
    if (operations.has(operationId)) {
      throw new Error(`Duplicate endpoint operation: ${operationId}`)
    }
    operations.add(operationId)

    const path = openApiPath(endpoint.path)
    paths[path] ||= {}
    paths[path][endpoint.method] = omitUndefined({
      operationId,
      summary: endpoint.definition.summary,
      description: endpoint.definition.description,
      tags: endpoint.definition.tags,
      parameters: createParameters(endpoint, schemaContext),
      requestBody: createRequestBody(endpoint.definition, schemaContext),
      responses: createResponses(endpoint.definition, schemaContext),
    })
  }

  const document = deepMergeOpenApiObject(
    omitUndefined({
      openapi: '3.1.0',
      info: {
        title: options.title || 'Nuxt Endpoints API',
        version: options.version || '0.1.0',
      },
      components: getJsonSchemaComponents(schemaContext),
      paths,
    }),
    options.document,
  ) as OpenApiDocument

  options.extend?.(document)

  return document
}

function openApiPath(path: string): string {
  return replacePathParams(path, (name) => `{${name}}`)
}

function fallbackOperationId(endpoint: OpenApiRoute): string {
  const parts = endpoint.path
    .split('/')
    .filter(Boolean)
    .map((part) => {
      return isPathParamSegment(part) ? `by-${part.slice(1)}` : part
    })

  return toCamelIdentifier([endpoint.method, ...parts].join('-'))
}

function toCamelIdentifier(value: string): string {
  const parts = value
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean)

  const [first = 'operation', ...rest] = parts
  return [
    first.toLowerCase(),
    ...rest.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`),
  ].join('')
}

function createParameters(
  endpoint: OpenApiRoute,
  schemaContext: JsonSchemaConversionContext,
): OpenApiParameter[] | undefined {
  const parameters: OpenApiParameter[] = [
    ...createParameterList(
      endpoint.definition.params,
      'path',
      pathParamNames(endpoint.path),
      schemaContext,
    ),
    ...createParameterList(endpoint.definition.query, 'query', [], schemaContext),
    ...createParameterList(endpoint.definition.headers, 'header', [], schemaContext),
  ]

  const idempotency = endpoint.definition.idempotency
  if (idempotency) {
    const headerInspection = endpoint.definition.headers
      ? inspectValidatorInputObject(endpoint.definition.headers)
      : undefined
    if (headerInspection && !headerInspection.inspectable) {
      throw new Error(
        `Endpoint ${endpoint.method.toUpperCase()} ${endpoint.path} uses idempotency with a headers schema whose fixed properties cannot be inspected. Provide a JSON-Schema-convertible object schema so header collisions can be checked.`,
      )
    }
    const duplicate = headerInspection
      ? Object.keys(headerInspection.properties).some(
          (name) => name.toLowerCase() === idempotency.headerName.toLowerCase(),
        )
      : false
    if (duplicate) {
      throw new Error(
        `Endpoint ${endpoint.method.toUpperCase()} ${endpoint.path} declares ${idempotency.headerName} twice through headers and idempotency metadata`,
      )
    }
    parameters.push({
      name: idempotency.headerName,
      in: 'header',
      required: idempotency.required,
      description: 'Client-provided idempotency key used to coordinate request replay.',
      schema: { type: 'string', minLength: 1, maxLength: 255 },
    })
  }

  return parameters.length > 0 ? parameters : undefined
}

type OpenApiParameter = {
  name: string
  in: 'path' | 'query' | 'header'
  required?: boolean
  schema: JsonSchema
  [key: string]: unknown
}

function createParameterList(
  schema: EndpointDefinition['params'],
  location: OpenApiParameter['in'],
  fallbackNames: string[] = [],
  schemaContext: JsonSchemaConversionContext,
): OpenApiParameter[] {
  const objectSchema = schema ? toJsonSchema(schema, schemaContext, { mode: 'input' }) : {}
  const inspection = inspectJsonSchemaObject(objectSchema, getJsonSchemaComponents(schemaContext))
  const properties = inspection.properties
  const required = inspection.required
  const names = unique([...fallbackNames, ...Object.keys(properties)])

  return names.map((name) => {
    return {
      name,
      in: location,
      required: location === 'path' ? true : required.includes(name),
      schema: properties[name] || {},
    }
  })
}

function createRequestBody(
  definition: EndpointDefinition,
  schemaContext: JsonSchemaConversionContext,
): OpenApiOperation['requestBody'] {
  if (!definition.body) {
    return undefined
  }

  return {
    required: !isOptionalSchema(definition.body),
    content: {
      'application/json': {
        schema: toJsonSchema(definition.body, schemaContext, { mode: 'input' }),
      },
    },
  }
}

function createResponses(
  definition: EndpointDefinition,
  schemaContext: JsonSchemaConversionContext,
): OpenApiOperation['responses'] {
  const responses = normalizeResponses(definition)
  const generated = Object.fromEntries(
    Object.entries(responses).map(([status, response]) => {
      return [
        status,
        omitUndefined({
          description: responseDescription(response),
          headers: responseHeaders(response, schemaContext),
          content: {
            [responseContentType(response)]: {
              schema: responseSchema(response, schemaContext),
            },
          },
        }),
      ]
    }),
  ) as OpenApiOperation['responses']

  if (definition.idempotency) {
    for (const status of [400, 409, 422] as const) {
      const existing = generated[status]
      const frameworkSchema = idempotencyProblemSchema(status, definition.idempotency.required)
      const existingProblem = existing?.content['application/problem+json']
      generated[status] = {
        ...existing,
        description: existing?.description ?? 'Idempotency request failure',
        content: {
          ...existing?.content,
          'application/problem+json': {
            ...existingProblem,
            schema: existingProblem
              ? { oneOf: [existingProblem.schema, frameworkSchema] }
              : frameworkSchema,
          },
        },
      }
    }
  }

  return generated
}

function idempotencyProblemSchema(status: 400 | 409 | 422, required: boolean): JsonSchema {
  const codes =
    status === 400
      ? required
        ? ['IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_KEY_INVALID']
        : ['IDEMPOTENCY_KEY_INVALID']
      : status === 409
        ? ['IDEMPOTENCY_REQUEST_IN_FLIGHT', 'IDEMPOTENCY_LEASE_LOST']
        : ['IDEMPOTENCY_KEY_REUSED']
  const title =
    status === 400 ? 'Bad Request' : status === 409 ? 'Conflict' : 'Unprocessable Content'

  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'title', 'status', 'detail', 'code'],
    properties: {
      type: { type: 'string', enum: ['about:blank'] },
      title: { type: 'string', enum: [title] },
      status: { type: 'integer', enum: [status] },
      detail: { type: 'string' },
      code: { type: 'string', enum: codes },
    },
  }
}

function normalizeResponses(definition: EndpointDefinition): EndpointResponsesContract {
  if (definition.responses) {
    return definition.responses
  }
  if (definition.response) {
    return { 200: definition.response }
  }
  return {}
}

function responseDescription(response: ResponseContract): string {
  if (
    typeof response === 'object' &&
    response !== null &&
    'description' in response &&
    typeof response.description === 'string'
  ) {
    return response.description
  }
  return 'Response'
}

function responseSchema(
  response: ResponseContract,
  schemaContext: JsonSchemaConversionContext,
): JsonSchema {
  if (typeof response === 'object' && response !== null && 'body' in response) {
    return toJsonSchema(response.body, schemaContext, { mode: 'output' })
  }
  return toJsonSchema(response, schemaContext, { mode: 'output' })
}

function responseContentType(response: ResponseContract): string {
  if (
    typeof response === 'object' &&
    response !== null &&
    'contentType' in response &&
    typeof response.contentType === 'string'
  ) {
    return response.contentType
  }
  return 'application/json'
}

function responseHeaders(
  response: ResponseContract,
  schemaContext: JsonSchemaConversionContext,
): Record<string, { schema: JsonSchema }> | undefined {
  if (
    typeof response !== 'object' ||
    response === null ||
    !('headers' in response) ||
    !response.headers
  ) {
    return undefined
  }

  const headers = Object.fromEntries(
    Object.entries(response.headers).map(([name, schema]) => {
      return [name, { schema: toJsonSchema(schema, schemaContext, { mode: 'output' }) }]
    }),
  )
  return Object.keys(headers).length > 0 ? headers : undefined
}

function unique(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index)
}

function deepMergeOpenApiObject<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown> | undefined,
): T {
  if (!source) {
    return target
  }

  for (const [key, sourceValue] of Object.entries(source)) {
    if (sourceValue === undefined) {
      continue
    }

    const targetValue = target[key]
    if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
      deepMergeOpenApiObject(targetValue, sourceValue)
      continue
    }

    target[key as keyof T] = sourceValue as T[keyof T]
  }

  return target
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function omitUndefined<T extends Record<string, unknown>>(object: T): T {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as T
}
