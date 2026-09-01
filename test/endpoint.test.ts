import { describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import type { StandardSchemaLike } from './internal-runtime'

vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>()
  return {
    ...actual,
    defineHandler: (handler: unknown) => handler,
    // h3 v2's thrown error carries `status`/`statusText` rather than v1's
    // `statusCode`/`statusMessage`; this fake mirrors that shape so it reads
    // back the same fields `createRuntimeError` sets.
    HTTPError: class HTTPError extends Error {
      status: number
      statusText?: string
      data?: unknown
      constructor(options: {
        status: number
        statusText?: string
        message?: string
        data?: unknown
      }) {
        super(options.message)
        this.status = options.status
        this.statusText = options.statusText
        this.data = options.data
      }
    },
    getQuery: (event: H3Event) => event.context.query || {},
    readBody: async (event: H3Event) => event.context.body || {},
  }
})

const numberParams: StandardSchemaLike<{ id: string }, { id: number }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate(input: unknown) {
      const value = input as { id: string }
      const id = Number(value.id)
      if (Number.isNaN(id)) {
        return { issues: [{ path: ['id'], message: 'Expected numeric string' }] }
      }
      return { value: { id } }
    },
  },
}

const userResponse: StandardSchemaLike<{ id: number; name: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate(input: unknown) {
      return { value: input as { id: number; name: string } }
    },
  },
}

const strictUserResponse: StandardSchemaLike<unknown, { id: number; name: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate(input: unknown) {
      const value = input as { id?: unknown; name?: unknown }
      if (typeof value.id !== 'number' || typeof value.name !== 'string') {
        return { issues: [{ message: 'Invalid user response' }] }
      }
      return { value: { id: value.id, name: value.name } }
    },
  },
}

const errorResponse: StandardSchemaLike<{ message: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate(input: unknown) {
      return { value: input as { message: string } }
    },
  },
}

describe('DefinedEndpoint', () => {
  it('passes a validated H3 event through defineRouteHandler', async () => {
    const { defineRouteHandler } = await import('./internal-runtime')
    const definition = {
      params: numberParams,
      handler: (event: any) => ({
        id: event.validated.params.id,
        ownsContract: event.routeDef.params === numberParams,
        isEvent: !('event' in event),
      }),
    }

    const handler = defineRouteHandler(definition)
    await expect(handler(createEvent({ params: { id: '42' } }))).resolves.toEqual({
      id: 42,
      ownsContract: true,
      isEvent: true,
    })
  })

  it('passes validated request data into the handler', async () => {
    const { defineEndpoint, defineEndpointHandler } = await import('./internal-runtime')

    const endpoint = defineEndpoint({
      params: numberParams,
      responses: { 200: userResponse },
    })

    const handler = defineEndpointHandler(endpoint, ({ params }) => {
      return { id: params.id, name: 'Tom' }
    })

    const result = await handler(createEvent({ params: { id: '123' } }))

    expect(result).toEqual({ id: 123, name: 'Tom' })
  })

  it('runs a single-define endpoint, handler and contract in one call', async () => {
    const { defineEndpoint } = await import('./internal-runtime')

    const handler = defineEndpoint({
      params: numberParams,
      responses: { 200: userResponse },
      handler: ({ params }) => ({ id: params.id, name: 'Tom' }),
    })

    const result = await handler(createEvent({ params: { id: '123' } }))

    expect(result).toEqual({ id: 123, name: 'Tom' })
  })

  it('still returns a reusable contract when the single define omits a handler', async () => {
    const { defineEndpoint, defineEndpointHandler } = await import('./internal-runtime')

    const endpoint = defineEndpoint({
      params: numberParams,
      responses: { 200: userResponse },
    })

    const handler = defineEndpointHandler(endpoint, ({ params }) => ({
      id: params.id,
      name: 'Tom',
    }))

    const result = await handler(createEvent({ params: { id: '7' } }))

    expect(result).toEqual({ id: 7, name: 'Tom' })
  })

  it('passes the H3 event, web request, and middleware context into the handler', async () => {
    const { defineEndpoint, defineEndpointHandler } = await import('./internal-runtime')

    const endpoint = defineEndpoint({
      responses: { 200: userResponse },
    })
    const requestEvent = createEvent({})
    requestEvent.context.user = { id: 123, name: 'Tom' }

    const handler = defineEndpointHandler(endpoint, ({ event, request }) => {
      expect(request).toBeInstanceOf(Request)
      return event.context.user as { id: number; name: string }
    })

    await expect(handler(requestEvent)).resolves.toEqual({ id: 123, name: 'Tom' })
  })

  it('returns declared error response bodies with status and headers', async () => {
    const { defineEndpoint, defineEndpointHandler } = await import('./internal-runtime')

    const endpoint = defineEndpoint({
      params: numberParams,
      responses: {
        200: userResponse,
        404: errorResponse,
      },
    })

    const handler = defineEndpointHandler(endpoint, ({ respond }) => {
      return respond(404, { message: 'Not found' }, { headers: { 'x-test': '1' } })
    })

    const event = createEvent({ params: { id: '123' } })
    await expect(handler(event)).resolves.toEqual({
      message: 'Not found',
    })

    expect(event.res.status).toBe(404)
    expect(event.res.headers.get('x-test')).toBe('1')
  })

  it('returns validation errors without exposing an exception stack', async () => {
    const { defineEndpoint, defineEndpointHandler } = await import('./internal-runtime')

    const endpoint = defineEndpoint({
      params: numberParams,
      responses: { 200: userResponse },
    })

    const handler = defineEndpointHandler(endpoint, () => {
      return { id: 1, name: 'Tom' }
    })

    const event = createEvent({ params: { id: 'abc' } })
    await expect(handler(event)).resolves.toEqual({
      statusCode: 400,
      statusMessage: 'Validation Error',
      data: {
        params: [{ path: ['id'], message: 'Expected numeric string' }],
      },
    })
    expect(event.res.status).toBe(400)
    expect(event.res.statusText).toBe('Validation Error')
    expect(event.res.headers.get('content-type')).toBe('application/json')
  })

  it('can validate response contracts at runtime', async () => {
    const { defineEndpoint, defineEndpointHandler } = await import('./internal-runtime')

    const endpoint = defineEndpoint(
      {
        responses: { 200: strictUserResponse },
      },
      { validation: { response: true } },
    )

    const handler = defineEndpointHandler(endpoint, () => {
      return { id: 'wrong', name: 'Tom' } as any
    })

    // h3 v2's error wire shape uses `status`/`statusText`, not v1's
    // `statusCode`/`statusMessage`.
    await expect(handler(createEvent({}))).rejects.toMatchObject({
      status: 500,
      statusText: 'Response Contract Error',
      data: {
        status: 200,
        issues: [{ message: 'Invalid user response' }],
      },
    })
  })

  it('rejects the removed singular `response` contract with a migration hint', async () => {
    const { defineEndpoint, defineRouteHandler } = await import('./internal-runtime')

    // TypeScript already rejects the key as an excess property, but discovery
    // jiti-evaluates plain JS route modules too, so the removal is enforced at
    // definition time as well.
    expect(() =>
      defineEndpoint({
        response: userResponse,
      } as never),
    ).toThrow('The `response` contract was removed; declare `responses: { 200: … }` instead.')

    expect(() =>
      defineRouteHandler({
        response: userResponse,
        handler: () => ({ id: 1, name: 'Tom' }),
      } as never),
    ).toThrow('The `response` contract was removed; declare `responses: { 200: … }` instead.')
  })

  it('rejects runtime-only idempotency options in route contracts', async () => {
    const { defineRouteHandler } = await import('./internal-runtime')
    const metadata = { enabled: true, headerName: 'Idempotency-Key', required: true }

    for (const runtimeOption of ['storage', 'scope', 'authorization'] as const) {
      expect(() =>
        defineRouteHandler({
          idempotency: { ...metadata, [runtimeOption]: () => undefined },
          handler: () => ({ ok: true }),
        } as never),
      ).toThrow(new RegExp(`Runtime-only idempotency option.*${runtimeOption}`))
    }

    expect(() =>
      defineRouteHandler({
        post: {
          idempotency: { ...metadata, storage: () => undefined },
          handler: () => ({ ok: true }),
        },
      } as never),
    ).toThrow(/Runtime-only idempotency option.*storage/)
  })

  it('rejects a declared response that mixes media with body', async () => {
    const { defineEndpoint } = await import('./internal-runtime')

    expect(() =>
      defineEndpoint({
        responses: {
          200: { media: 'text/csv', body: userResponse } as never,
        },
      }),
    ).toThrow(/declares both media and body/)
  })

  it('rejects a declared media list with no media types in it', async () => {
    const { defineEndpoint } = await import('./internal-runtime')

    expect(() =>
      defineEndpoint({
        responses: {
          200: { media: [] },
        },
      }),
    ).toThrow(/empty list of media types/)
  })

  it('rejects a declared media list containing an empty media type', async () => {
    const { defineEndpoint } = await import('./internal-runtime')

    expect(() =>
      defineEndpoint({
        responses: {
          200: { media: ['text/csv', ''] },
        },
      }),
    ).toThrow(/declares an empty media type/)
  })

  it('rejects a media type that is not a single lowercase type/subtype', async () => {
    const { defineEndpoint } = await import('./internal-runtime')

    // A comma-joined string is an easy typo now that the array form exists,
    // and would otherwise be sent verbatim as one Content-Type.
    expect(() =>
      defineEndpoint({ responses: { 200: { media: 'text/csv, application/json' } } }),
    ).toThrow(/not a single type\/subtype media type/)
    // Without the shape check these reach the runtime and negotiate to
    // nothing, so every request to the endpoint would answer 406.
    expect(() => defineEndpoint({ responses: { 200: { media: ['csv', 'json'] } } })).toThrow(
      /not a single type\/subtype media type/,
    )
    expect(() => defineEndpoint({ responses: { 200: { media: 'TEXT/CSV' } } })).toThrow(
      /must be lowercase/,
    )
    expect(() => defineEndpoint({ responses: { 200: { media: ' text/csv' } } })).toThrow(
      /must be lowercase and free of surrounding whitespace/,
    )
  })

  it('rejects one schema shared by several media types', async () => {
    const { defineEndpoint } = await import('./internal-runtime')
    const { z } = await import('zod')

    expect(() =>
      defineEndpoint({
        responses: {
          200: { media: ['text/csv', 'application/json'], schema: z.object({ id: z.string() }) },
        },
      }),
    ).toThrow(/One schema cannot describe them all/)

    // A single media type still takes a bare schema: there is nothing ambiguous
    // about which representation it documents.
    expect(() =>
      defineEndpoint({
        responses: { 200: { media: 'application/x-ndjson', schema: z.object({ id: z.string() }) } },
      }),
    ).not.toThrow()
  })

  it('rejects a schema keyed by a media type the response does not declare', async () => {
    const { defineEndpoint } = await import('./internal-runtime')
    const { z } = await import('zod')

    expect(() =>
      defineEndpoint({
        responses: {
          200: {
            media: ['text/csv', 'application/json'],
            schema: { 'application/xml': z.object({ id: z.string() }) },
          },
        },
      }),
    ).toThrow(/does not declare in media/)
  })

  it('rejects a media type declared twice for one status', async () => {
    const { defineEndpoint } = await import('./internal-runtime')

    expect(() =>
      defineEndpoint({ responses: { 200: { media: ['text/csv', 'text/csv'] } } }),
    ).toThrow(/declares media type "text\/csv" more than once/)
  })

  it('rejects a declared contentType that is not a string', async () => {
    const { defineEndpoint } = await import('./internal-runtime')

    expect(() =>
      defineEndpoint({
        responses: {
          200: { body: userResponse, contentType: 123 as never },
        },
      }),
    ).toThrow(/declares a contentType that is not a string/)
  })

  it('rejects a non-JSON contentType on a validated body', async () => {
    const { defineEndpoint } = await import('./internal-runtime')

    expect(() =>
      defineEndpoint({
        responses: {
          200: { body: userResponse, contentType: 'text/csv' },
        },
      }),
    ).toThrow(/on a validated body, which is always sent as JSON/)

    expect(() =>
      defineEndpoint({
        responses: {
          200: { body: userResponse, contentType: 'text/csv' },
        },
      }),
    ).toThrow(/media: 'text\/csv'/)
  })
})

function createEvent(input: {
  params?: Record<string, string>
  query?: Record<string, unknown>
  body?: unknown
}): H3Event {
  return {
    req: new Request('http://localhost/test'),
    res: { status: 200, statusText: undefined, headers: new Headers() },
    context: {
      params: input.params,
      query: input.query,
      body: input.body,
    },
  } as unknown as H3Event
}
