import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'
import * as v from 'valibot'
import { z } from 'zod'
import { createOpenApiDocument } from '../src/runtime'
import type { JsonSchema, StandardSchemaLike } from '../src/runtime'

describe('createOpenApiDocument', () => {
  it('generates an OpenAPI document from endpoint contracts', () => {
    const document = createOpenApiDocument(
      [
        {
          path: '/api/users/:id',
          method: 'get',
          definition: {
            operation: 'getUser',
            summary: 'Get user',
            params: z.object({
              id: z.string().uuid(),
            }),
            query: z.object({
              includeAge: z.coerce.boolean().optional(),
            }),
            response: {
              description: 'User response',
              body: z.object({
                id: z.number().int(),
                name: z.string(),
                age: z.number().optional(),
              }),
              headers: {
                'x-request-id': z.string(),
              },
            },
          },
        },
      ],
      { title: 'Example API', version: '1.2.3' },
    )

    expect(document.openapi).toBe('3.1.0')
    expect(document.info).toEqual({ title: 'Example API', version: '1.2.3' })
    expect(document.paths['/api/users/{id}'].get.operationId).toBe('getUser')
    expect(document.paths['/api/users/{id}'].get.parameters).toMatchObject([
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
      {
        name: 'includeAge',
        in: 'query',
        required: false,
        schema: { type: ['boolean', 'null'] },
      },
    ])
    expect(document.paths['/api/users/{id}'].get.responses[200]).toMatchObject({
      description: 'User response',
      headers: {
        'x-request-id': {
          schema: { type: 'string' },
        },
      },
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['id', 'name'],
            properties: {
              id: { type: 'integer' },
              name: { type: 'string' },
              age: { type: 'number' },
            },
          },
        },
      },
    })
  })

  it('generates request bodies from body contracts', () => {
    const document = createOpenApiDocument([
      {
        path: '/api/users',
        method: 'post',
        definition: {
          operation: 'createUser',
          body: z.object({
            name: z.string().min(1),
          }),
          responses: {
            201: z.object({
              id: z.number(),
              name: z.string(),
            }),
          },
        },
      },
    ])

    expect(document.paths['/api/users'].post.requestBody).toMatchObject({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', minLength: 1 },
            },
          },
        },
      },
    })
  })

  it('generates a multi-media-type request body from a media-type-map body contract', () => {
    const document = createOpenApiDocument([
      {
        path: '/api/uploads',
        method: 'post',
        definition: {
          operation: 'createUpload',
          body: {
            'application/json': z.object({ name: z.string() }),
            'multipart/form-data': z.object({ name: z.string(), tag: z.array(z.string()) }),
          },
          responses: {
            201: z.object({ id: z.number() }),
          },
        },
      },
    ])

    expect(document.paths['/api/uploads'].post.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string' } },
          },
        },
        'multipart/form-data': {
          schema: {
            type: 'object',
            required: ['name', 'tag'],
            properties: {
              name: { type: 'string' },
              tag: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    })
  })

  it('uses Valibot input schemas for requests and output schemas for responses', () => {
    const numberFromString = v.pipe(v.string(), v.transform(Number), v.number())

    const document = createOpenApiDocument([
      {
        path: '/api/items',
        method: 'post',
        definition: {
          operation: 'createItem',
          body: v.object({
            id: numberFromString,
          }),
          response: v.object({
            id: numberFromString,
          }),
        },
      },
    ])

    expect(
      document.paths['/api/items'].post.requestBody?.content['application/json'].schema,
    ).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    })
    expect(
      document.paths['/api/items'].post.responses[200].content['application/json'].schema,
    ).toEqual({
      type: 'object',
      properties: {
        id: { type: 'number' },
      },
      required: ['id'],
    })
  })

  it('generates OpenAPI schemas from Effect Schema contracts', () => {
    const document = createOpenApiDocument([
      {
        path: '/api/effect-items',
        method: 'post',
        definition: {
          operation: 'createEffectItem',
          body: Schema.Struct({ name: Schema.String }),
          response: Schema.Struct({ id: Schema.Number, name: Schema.String }),
        },
      },
    ])

    expect(
      document.paths['/api/effect-items'].post.requestBody?.content['application/json'].schema,
    ).toMatchObject({
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    })
    expect(
      document.paths['/api/effect-items'].post.responses[200].content['application/json'].schema,
    ).toMatchObject({
      type: 'object',
      required: ['id', 'name'],
      properties: { id: { type: 'number' }, name: { type: 'string' } },
    })
  })

  it('emits components for named Zod schemas', () => {
    const User = z
      .object({
        id: z.string().uuid(),
        name: z.string(),
      })
      .meta({ id: 'User' })

    const document = createOpenApiDocument([
      {
        path: '/api/users/:id',
        method: 'get',
        definition: {
          operation: 'getUser',
          params: z.object({ id: z.string().uuid() }),
          response: User,
        },
      },
    ])

    expect(document.paths['/api/users/{id}'].get.responses[200].content).toEqual({
      'application/json': {
        schema: { $ref: '#/components/schemas/User' },
      },
    })
    expect(document.components?.schemas?.User).toMatchObject({
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
      },
    })
  })

  it('allows OpenAPI-specific document patches and post-processing', () => {
    const document = createOpenApiDocument(
      [
        {
          path: '/api/users/:id',
          method: 'get',
          definition: {
            operation: 'getUser',
            params: z.object({ id: z.string().uuid() }),
            response: z.object({
              id: z.string().uuid(),
              name: z.string(),
            }),
          },
        },
      ],
      {
        document: {
          servers: [{ url: 'https://api.example.com' }],
          security: [{ bearerAuth: [] }],
          components: {
            securitySchemes: {
              bearerAuth: { type: 'http', scheme: 'bearer' },
            },
          },
          paths: {
            '/api/users/{id}': {
              get: {
                externalDocs: { url: 'https://docs.example.com/users' },
                'x-owner': 'platform',
              },
            },
          },
        },
        extend(document) {
          document.components ??= {}
          document.components.examples = {
            UserExample: { value: { id: '12121212-1212-4121-8121-121212121212' } },
          }

          const operation = document.paths['/api/users/{id}'].get
          operation.security = [{ bearerAuth: [] }]
          operation.responses[200].links = {
            userOrders: {
              operationId: 'listUserOrders',
              parameters: { userId: '$response.body#/id' },
            },
          }
          operation.responses[200].content['application/json'].examples = {
            user: { value: { id: '12121212-1212-4121-8121-121212121212', name: 'Tom' } },
          }
        },
      },
    )

    expect(document.servers).toEqual([{ url: 'https://api.example.com' }])
    expect(document.security).toEqual([{ bearerAuth: [] }])
    expect(document.components?.securitySchemes).toEqual({
      bearerAuth: { type: 'http', scheme: 'bearer' },
    })
    expect(document.components?.examples).toEqual({
      UserExample: { value: { id: '12121212-1212-4121-8121-121212121212' } },
    })
    expect(document.paths['/api/users/{id}'].get).toMatchObject({
      operationId: 'getUser',
      externalDocs: { url: 'https://docs.example.com/users' },
      security: [{ bearerAuth: [] }],
      'x-owner': 'platform',
    })
    expect(document.paths['/api/users/{id}'].get.responses[200].links).toEqual({
      userOrders: {
        operationId: 'listUserOrders',
        parameters: { userId: '$response.body#/id' },
      },
    })
    expect(
      document.paths['/api/users/{id}'].get.responses[200].content['application/json'].examples,
    ).toEqual({
      user: { value: { id: '12121212-1212-4121-8121-121212121212', name: 'Tom' } },
    })
  })

  it('generates fallback operation ids when operation is omitted', () => {
    const document = createOpenApiDocument([
      {
        path: '/api/users/:userId/posts/:postId',
        method: 'get',
        definition: {
          params: z.object({
            userId: z.string(),
            postId: z.string(),
          }),
          response: z.object({
            id: z.string(),
          }),
        },
      },
    ])

    expect(document.paths['/api/users/{userId}/posts/{postId}'].get.operationId).toBe(
      'getApiUsersByUserIdPostsByPostId',
    )
  })

  it('rejects duplicate operations', () => {
    expect(() => {
      createOpenApiDocument([
        {
          path: '/api/users',
          method: 'get',
          definition: {
            operation: 'listUsers',
            response: z.array(z.object({ id: z.string() })),
          },
        },
        {
          path: '/api/members',
          method: 'get',
          definition: {
            operation: 'listUsers',
            response: z.array(z.object({ id: z.string() })),
          },
        },
      ])
    }).toThrow('Duplicate endpoint operation: listUsers')
  })

  it('documents idempotency headers and framework Problem Details responses', () => {
    const document = createOpenApiDocument([
      {
        path: '/api/items',
        method: 'post',
        definition: {
          operation: 'createItem',
          idempotency: {
            enabled: true,
            headerName: 'X-Request-Key',
            required: true,
          },
          responses: {
            201: z.object({ id: z.number() }),
            409: {
              contentType: 'application/json',
              body: z.object({ message: z.string() }),
            },
          },
        },
      },
    ])
    const operation = document.paths['/api/items'].post

    expect(operation.parameters).toContainEqual({
      name: 'X-Request-Key',
      in: 'header',
      required: true,
      description: expect.stringContaining('idempotency'),
      schema: { type: 'string', minLength: 1, maxLength: 255 },
    })
    expect(operation.responses[400].content['application/problem+json'].schema).toMatchObject({
      type: 'object',
      required: ['type', 'title', 'status', 'detail', 'code'],
    })
    expect(operation.responses[409].content).toHaveProperty('application/json')
    expect(operation.responses[409].content).toHaveProperty('application/problem+json')
    expect(operation.responses[422].content['application/problem+json'].schema).toMatchObject({
      properties: { code: { enum: ['IDEMPOTENCY_KEY_REUSED'] } },
    })
  })

  it('rejects a case-insensitive collision with a declared request header', () => {
    expect(() =>
      createOpenApiDocument([
        {
          path: '/api/items',
          method: 'post',
          definition: {
            idempotency: {
              enabled: true,
              headerName: 'Idempotency-Key',
              required: false,
            },
            headers: z.object({ 'IDEMPOTENCY-KEY': z.string() }),
          },
        },
      ]),
    ).toThrow(/declares Idempotency-Key twice/i)
  })

  it('combines a declared Problem Details response with the framework problem schema', () => {
    const document = createOpenApiDocument([
      {
        path: '/api/items',
        method: 'post',
        definition: {
          idempotency: {
            enabled: true,
            headerName: 'Idempotency-Key',
            required: true,
          },
          responses: {
            409: {
              contentType: 'application/problem+json',
              body: z.object({ message: z.string() }),
            },
          },
        },
      },
    ])

    expect(
      document.paths['/api/items'].post.responses[409].content['application/problem+json'].schema,
    ).toMatchObject({
      oneOf: [
        { type: 'object', required: ['message'] },
        { type: 'object', required: ['type', 'title', 'status', 'detail', 'code'] },
      ],
    })
  })

  it('rejects idempotency header collisions hidden behind named schema references', () => {
    const NamedHeaders = z
      .object({ 'idempotency-key': z.string() })
      .meta({ id: 'IdempotentRequestHeaders' })

    expect(() =>
      createOpenApiDocument([
        {
          path: '/api/items',
          method: 'post',
          definition: {
            idempotency: {
              enabled: true,
              headerName: 'Idempotency-Key',
              required: true,
            },
            headers: NamedHeaders,
          },
        },
      ]),
    ).toThrow(/declares Idempotency-Key twice/i)
  })

  it('rejects opaque header schemas when collision safety cannot be inspected', () => {
    const opaqueHeaders: StandardSchemaLike<Record<string, string>> = {
      '~standard': {
        version: 1,
        vendor: 'opaque-test',
        validate(input) {
          return { value: input as Record<string, string> }
        },
      },
    }

    expect(() =>
      createOpenApiDocument([
        {
          path: '/api/items',
          method: 'post',
          definition: {
            idempotency: {
              enabled: true,
              headerName: 'Idempotency-Key',
              required: true,
            },
            headers: opaqueHeaders,
          },
        },
      ]),
    ).toThrow(/fixed properties cannot be inspected/i)
  })

  it('does not mark alternative-only JSON Schema properties as universally required', () => {
    const alternativeHeaders = {
      '~standard': {
        version: 1 as const,
        vendor: 'alternatives-test',
        validate(input: unknown) {
          return { value: input as { a?: string; b?: string } }
        },
      },
      jsonSchema: {
        anyOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { b: { type: 'string' } }, required: ['b'] },
        ],
      } satisfies JsonSchema,
    } satisfies StandardSchemaLike<{ a?: string; b?: string }> & { jsonSchema: JsonSchema }

    const document = createOpenApiDocument([
      {
        path: '/api/items',
        method: 'get',
        definition: { headers: alternativeHeaders },
      },
    ])

    expect(document.paths['/api/items'].get.parameters).toEqual([
      { name: 'a', in: 'header', required: false, schema: { type: 'string' } },
      { name: 'b', in: 'header', required: false, schema: { type: 'string' } },
    ])
  })

  it('preserves composed constraints for the same parameter property', () => {
    const composedQuery = {
      '~standard': {
        version: 1 as const,
        vendor: 'composed-query-test',
        validate(input: unknown) {
          return { value: input as { mode?: 'a' | 'b'; value?: string } }
        },
      },
      jsonSchema: {
        type: 'object',
        anyOf: [{ properties: { mode: { const: 'a' } } }, { properties: { mode: { const: 'b' } } }],
        allOf: [
          { properties: { value: { type: 'string', minLength: 1 } } },
          { properties: { value: { type: 'string', maxLength: 10 } } },
        ],
      } satisfies JsonSchema,
    } satisfies StandardSchemaLike<{ mode?: 'a' | 'b'; value?: string }> & {
      jsonSchema: JsonSchema
    }

    const document = createOpenApiDocument([
      {
        path: '/api/items',
        method: 'get',
        definition: { query: composedQuery },
      },
    ])

    expect(document.paths['/api/items'].get.parameters).toEqual([
      {
        name: 'value',
        in: 'query',
        required: false,
        schema: {
          allOf: [
            { type: 'string', minLength: 1 },
            { type: 'string', maxLength: 10 },
          ],
        },
      },
      {
        name: 'mode',
        in: 'query',
        required: false,
        schema: { anyOf: [{ const: 'a' }, { const: 'b' }] },
      },
    ])
  })
})
