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
            summary: 'Get user',
            params: z.object({
              id: z.string().uuid(),
            }),
            query: z.object({
              includeAge: z.coerce.boolean().optional(),
            }),
            responses: {
              200: {
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
        },
      ],
      { title: 'Example API', version: '1.2.3' },
    )

    expect(document.openapi).toBe('3.1.0')
    expect(document.info).toEqual({ title: 'Example API', version: '1.2.3' })
    expect(document.paths['/api/users/{id}'].get.operationId).toBe('getApiUsersById')
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
        schema: { type: 'boolean' },
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

    // A request body documents what a caller may send, so it is converted in
    // Zod's input direction. That view carries no `additionalProperties: false`,
    // and it is the honest one: `z.object` accepts extra keys and strips them
    // rather than rejecting them. Only `z.strictObject` rejects, and it reports
    // the constraint in both directions.
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
    expect(
      document.paths['/api/users']!.post!.requestBody!.content['application/json']!.schema,
    ).not.toHaveProperty('additionalProperties')
  })

  it('documents a request body whose schema transforms its input', () => {
    // Regression: the conversion asked for the input direction but never passed
    // it to Zod, so Zod answered in its output direction - which is
    // unrepresentable for a schema carrying `transform`/`pipe` and yielded `{}`.
    // A contract declared that way documented as an empty schema.
    const Confirmed = z
      .object({ email: z.string(), password: z.string().min(8), confirmPassword: z.string() })
      .refine((value) => value.password === value.confirmPassword, {
        path: ['confirmPassword'],
        message: 'Passwords do not match',
      })
      // Naming the discarded key aliases it, which is the idiom that keeps the
      // omit form readable without tripping the unused-parameter rule.
      .transform(({ confirmPassword: _confirmPassword, ...rest }) => rest)

    const document = createOpenApiDocument([
      {
        path: '/api/signups',
        method: 'post',
        definition: {
          body: Confirmed,
          responses: { 201: z.object({ id: z.number().int() }) },
        },
      },
    ])

    const schema =
      document.paths['/api/signups']!.post!.requestBody!.content['application/json']!.schema

    // The caller sends the form's own shape, confirmation field included.
    expect(schema).toMatchObject({
      type: 'object',
      required: ['email', 'password', 'confirmPassword'],
      properties: {
        email: { type: 'string' },
        password: { type: 'string', minLength: 8 },
        confirmPassword: { type: 'string' },
      },
    })
  })

  it('generates a multi-media-type request body from a media-type-map body contract', () => {
    const document = createOpenApiDocument([
      {
        path: '/api/uploads',
        method: 'post',
        definition: {
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
          body: v.object({
            id: numberFromString,
          }),
          responses: {
            200: v.object({
              id: numberFromString,
            }),
          },
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
          body: Schema.Struct({ name: Schema.String }),
          responses: { 200: Schema.Struct({ id: Schema.Number, name: Schema.String }) },
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
    const Profile = z.object({ displayName: z.string() }).meta({ id: 'Profile' })
    const User = z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        profile: Profile,
      })
      .meta({ id: 'User' })

    const document = createOpenApiDocument([
      {
        path: '/api/users/:id',
        method: 'get',
        definition: {
          params: z.object({ id: z.string().uuid() }),
          responses: { 200: User },
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
      required: ['id', 'name', 'profile'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        profile: { $ref: '#/components/schemas/Profile' },
      },
    })
    expect(document.components?.schemas?.Profile).toMatchObject({
      type: 'object',
      required: ['displayName'],
      properties: { displayName: { type: 'string' } },
    })
  })

  it('allows OpenAPI-specific document patches and post-processing', () => {
    const document = createOpenApiDocument(
      [
        {
          path: '/api/users/:id',
          method: 'get',
          definition: {
            params: z.object({ id: z.string().uuid() }),
            responses: {
              200: z.object({
                id: z.string().uuid(),
                name: z.string(),
              }),
            },
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
      operationId: 'getApiUsersById',
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

  it('generates operation ids from the method and path', () => {
    const document = createOpenApiDocument([
      {
        path: '/api/users/:userId/posts/:postId',
        method: 'get',
        definition: {
          params: z.object({
            userId: z.string(),
            postId: z.string(),
          }),
          responses: {
            200: z.object({
              id: z.string(),
            }),
          },
        },
      },
    ])

    expect(document.paths['/api/users/{userId}/posts/{postId}'].get.operationId).toBe(
      'getApiUsersByUserIdPostsByPostId',
    )
  })

  it('rejects duplicate generated operation ids', () => {
    expect(() => {
      createOpenApiDocument([
        {
          path: '/api/users',
          method: 'get',
          definition: {
            responses: { 200: z.array(z.object({ id: z.string() })) },
          },
        },
        {
          path: '/api/users',
          method: 'get',
          definition: {
            responses: { 200: z.array(z.object({ id: z.string() })) },
          },
        },
      ])
    }).toThrow('Duplicate endpoint operation: getApiUsers')
  })

  it('documents idempotency headers and framework Problem Details responses', () => {
    const document = createOpenApiDocument([
      {
        path: '/api/items',
        method: 'post',
        definition: {
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

  describe('media response contracts', () => {
    it('uses a declared media and description', () => {
      const document = createOpenApiDocument([
        {
          path: '/api/export',
          method: 'get',
          definition: {
            responses: {
              200: { media: 'text/csv', description: 'CSV export' },
            },
          },
        },
      ])

      expect(document.paths['/api/export'].get.responses[200]).toMatchObject({
        description: 'CSV export',
        content: {
          'text/csv': {
            schema: { type: 'string', contentEncoding: 'binary' },
          },
        },
      })
    })

    it('converts a declared schema into the JSON Schema documenting the media response instead of the binary placeholder', () => {
      const document = createOpenApiDocument([
        {
          path: '/api/export',
          method: 'get',
          definition: {
            responses: {
              200: {
                media: 'text/csv',
                schema: z.object({ id: z.string(), name: z.string() }),
              },
            },
          },
        },
      ])

      expect(document.paths['/api/export'].get.responses[200].content['text/csv'].schema).toEqual({
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
      })
    })

    it('emits one content entry per declared media type, each describing the same payload', () => {
      const document = createOpenApiDocument([
        {
          path: '/api/export',
          method: 'get',
          definition: {
            responses: {
              200: { media: ['text/csv', 'application/json'] },
            },
          },
        },
      ])

      const content = document.paths['/api/export'].get.responses[200].content
      expect(Object.keys(content)).toEqual(['text/csv', 'application/json'])
      expect(content['text/csv'].schema).toEqual({ type: 'string', contentEncoding: 'binary' })
      expect(content['application/json'].schema).toEqual(content['text/csv'].schema)
    })

    it('documents each declared media type with its own schema', () => {
      const document = createOpenApiDocument([
        {
          path: '/api/export',
          method: 'get',
          definition: {
            responses: {
              200: {
                media: ['text/csv', 'application/json'],
                // One schema cannot describe a CSV and a JSON object at once,
                // so each representation names its own - and the one that
                // names none stays opaque bytes.
                schema: { 'application/json': z.object({ id: z.string(), name: z.string() }) },
              },
            },
          },
        },
      ])

      const content = document.paths['/api/export'].get.responses[200].content
      expect(Object.keys(content)).toEqual(['text/csv', 'application/json'])
      expect(content['text/csv'].schema).toEqual({ type: 'string', contentEncoding: 'binary' })
      expect(content['application/json'].schema).toEqual({
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
      })
    })

    it('uses a validated contentType as the content key instead of application/json', () => {
      const document = createOpenApiDocument([
        {
          path: '/api/problem',
          method: 'get',
          definition: {
            responses: {
              404: {
                body: z.object({ type: z.string(), title: z.string() }),
                contentType: 'application/problem+json',
              },
            },
          },
        },
      ])

      expect(document.paths['/api/problem'].get.responses[404]).toMatchObject({
        content: {
          'application/problem+json': {
            schema: {
              type: 'object',
              required: ['type', 'title'],
              properties: {
                type: { type: 'string' },
                title: { type: 'string' },
              },
            },
          },
        },
      })
    })
  })

  describe('framework-generated responses', () => {
    it('documents the validation failure any validating endpoint can answer with', () => {
      const document = createOpenApiDocument([
        {
          path: '/api/users/:id',
          method: 'get',
          definition: {
            params: z.object({ id: z.string() }),
            responses: { 200: z.object({ id: z.string() }) },
          },
        },
      ])

      const failure = document.paths['/api/users/{id}'].get.responses[400]
      expect(failure.content['application/json'].schema).toMatchObject({
        properties: {
          statusCode: { enum: [400] },
          statusMessage: { enum: ['Validation Error'] },
        },
      })
    })

    it('documents nothing extra for an endpoint that validates nothing', () => {
      const document = createOpenApiDocument([
        {
          path: '/api/health',
          method: 'get',
          definition: { responses: { 200: z.object({ ok: z.boolean() }) } },
        },
      ])

      expect(Object.keys(document.paths['/api/health'].get.responses)).toEqual(['200'])
    })

    it('documents the 415 a media-type-map body can answer with', () => {
      const document = createOpenApiDocument([
        {
          path: '/api/upload',
          method: 'post',
          definition: {
            body: {
              'application/json': z.object({ name: z.string() }),
              'multipart/form-data': z.object({ name: z.string() }),
            },
            responses: { 201: z.object({ name: z.string() }) },
          },
        },
      ])

      expect(
        document.paths['/api/upload'].post.responses[415].content['application/json'].schema,
      ).toMatchObject({ properties: { statusCode: { enum: [415] } } })
    })

    it('documents the 406 a negotiating endpoint can answer with', () => {
      const document = createOpenApiDocument([
        {
          path: '/api/export',
          method: 'get',
          definition: {
            responses: { 200: { media: ['text/csv', 'application/json'] } },
          },
        },
      ])

      expect(
        document.paths['/api/export'].get.responses[406].content['application/json'].schema,
      ).toMatchObject({ properties: { statusCode: { enum: [406] } } })
    })

    it('documents no 406 when the endpoint offers a single representation', () => {
      const document = createOpenApiDocument([
        {
          path: '/api/export',
          method: 'get',
          definition: { responses: { 200: { media: 'text/csv' } } },
        },
      ])

      expect(document.paths['/api/export'].get.responses[406]).toBeUndefined()
    })

    it('keeps an author-declared status alongside the generated one', () => {
      const document = createOpenApiDocument([
        {
          path: '/api/users',
          method: 'post',
          definition: {
            body: z.object({ name: z.string() }),
            responses: {
              201: z.object({ id: z.string() }),
              400: z.object({ reason: z.string() }),
            },
          },
        },
      ])

      const declared = document.paths['/api/users'].post.responses[400]
      expect(declared.content['application/json'].schema).toMatchObject({
        oneOf: [
          { properties: { reason: { type: 'string' } } },
          { properties: { statusCode: { enum: [400] } } },
        ],
      })
    })
  })
})
