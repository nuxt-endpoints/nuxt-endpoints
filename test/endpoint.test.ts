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
const numberParams: StandardSchemaLike<
  {
    id: string
  },
  {
    id: number
  }
> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate(input: unknown) {
      const value = input as {
        id: string
      }
      const id = Number(value.id)
      if (Number.isNaN(id)) {
        return {
          issues: [
            {
              path: ['id'],
              message: 'Expected numeric string',
              code: 'invalid_number',
              input: value.id,
              expected: 'numeric string',
            },
          ],
        }
      }
      return { value: { id } }
    },
  },
}
const userResponse: StandardSchemaLike<{
  id: number
  name: string
}> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate(input: unknown) {
      return {
        value: input as {
          id: number
          name: string
        },
      }
    },
  },
}
const strictUserResponse: StandardSchemaLike<
  unknown,
  {
    id: number
    name: string
  }
> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate(input: unknown) {
      const value = input as {
        id?: unknown
        name?: unknown
      }
      if (typeof value.id !== 'number' || typeof value.name !== 'string') {
        return { issues: [{ message: 'Invalid user response' }] }
      }
      return { value: { id: value.id, name: value.name } }
    },
  },
}
const requestIdHeader: StandardSchemaLike<unknown, string> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate(input: unknown) {
      if (typeof input !== 'string' || !input.startsWith('req-')) {
        return { issues: [{ message: 'Invalid request id header' }] }
      }
      return { value: input }
    },
  },
}
const errorResponse: StandardSchemaLike<{
  message: string
}> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate(input: unknown) {
      return {
        value: input as {
          message: string
        },
      }
    },
  },
}
describe('DefinedEndpoint', () => {
  it('passes a validated H3 event through defineEndpoint', async () => {
    const { defineEndpoint } = await import('./internal-runtime')
    const definition = {
      request: { params: numberParams },
      handler: (event: any) => ({
        id: event.validated.params.id,
        ownsContract: event.routeDef.params === numberParams,
        isEvent: !('event' in event),
      }),
    }
    const handler = defineEndpoint(definition)
    await expect(handler(createEvent({ params: { id: '42' } }) as never)).resolves.toEqual({
      id: 42,
      ownsContract: true,
      isEvent: true,
    })
  })
  it('passes validated request data into the handler', async () => {
    const { defineEndpointContract, defineEndpointHandler } = await import('./internal-runtime')
    const endpoint = defineEndpointContract({
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
    const { defineEndpointContract } = await import('./internal-runtime')
    const handler = defineEndpointContract({
      params: numberParams,
      responses: { 200: userResponse },
      handler: ({ params }) => ({ id: params.id, name: 'Tom' }),
    })
    const result = await handler(createEvent({ params: { id: '123' } }))
    expect(result).toEqual({ id: 123, name: 'Tom' })
  })
  it('still returns a reusable contract when the single define omits a handler', async () => {
    const { defineEndpointContract, defineEndpointHandler } = await import('./internal-runtime')
    const endpoint = defineEndpointContract({
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
    const { defineEndpointContract, defineEndpointHandler } = await import('./internal-runtime')
    const endpoint = defineEndpointContract({
      responses: { 200: userResponse },
    })
    const requestEvent = createEvent({})
    requestEvent.context.user = { id: 123, name: 'Tom' }
    const handler = defineEndpointHandler(endpoint, ({ event, request }) => {
      expect(request).toBeInstanceOf(Request)
      return event.context.user as {
        id: number
        name: string
      }
    })
    await expect(handler(requestEvent)).resolves.toEqual({ id: 123, name: 'Tom' })
  })
  it('returns declared error response bodies with status and headers', async () => {
    const { defineEndpointContract, defineEndpointHandler } = await import('./internal-runtime')
    const endpoint = defineEndpointContract({
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
    const { defineEndpointContract, defineEndpointHandler } = await import('./internal-runtime')
    const endpoint = defineEndpointContract({
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
        params: [
          {
            path: ['id'],
            message: 'Expected numeric string',
            code: 'invalid_number',
            input: 'abc',
            expected: 'numeric string',
          },
        ],
      },
    })
    expect(event.res.status).toBe(400)
    expect(event.res.statusText).toBe('Validation Error')
    expect(event.res.headers.get('content-type')).toBe('application/json')
  })
  it('can validate response contracts at runtime', async () => {
    const { defineEndpointContract, defineEndpointHandler } = await import('./internal-runtime')
    const endpoint = defineEndpointContract(
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
  it('can disable response validation when the server runtime resolves it off', async () => {
    const { defineEndpointContract, defineEndpointHandler } = await import('./internal-runtime')
    const endpoint = defineEndpointContract(
      { responses: { 200: strictUserResponse } },
      { validation: { response: true } },
    )
    const handler = defineEndpointHandler(endpoint, () => ({ id: 'wrong', name: 'Tom' }) as any)
    const attachRuntime = handler.__set_endpoint_runtime__ as (...args: unknown[]) => void
    attachRuntime(undefined, undefined, undefined, { responseValidation: false })
    await expect(handler(createEvent({}))).resolves.toEqual({ id: 'wrong', name: 'Tom' })
  })
  it('still rejects an undeclared status when response schema validation is off', async () => {
    const { defineEndpointContract, defineEndpointHandler, respond } =
      await import('./internal-runtime')
    const endpoint = defineEndpointContract(
      { responses: { 200: strictUserResponse } },
      { validation: { response: false } },
    )
    const handler = defineEndpointHandler(
      endpoint,
      () => respond(201, { id: 1, name: 'Tom' }) as never,
    )
    await expect(handler(createEvent({}))).rejects.toMatchObject({
      status: 500,
      statusText: 'Response Contract Error',
      data: { status: 201, issues: [{ message: 'Response status 201 is not declared' }] },
    })
  })
  it('can enable response validation when the server runtime resolves it on', async () => {
    const { defineEndpointContract, defineEndpointHandler } = await import('./internal-runtime')
    const endpoint = defineEndpointContract(
      { responses: { 200: strictUserResponse } },
      { validation: { response: false } },
    )
    const handler = defineEndpointHandler(endpoint, () => ({ id: 'wrong', name: 'Tom' }) as any)
    const attachRuntime = handler.__set_endpoint_runtime__ as (...args: unknown[]) => void
    attachRuntime(undefined, undefined, undefined, { responseValidation: true })
    await expect(handler(createEvent({}))).rejects.toMatchObject({
      status: 500,
      statusText: 'Response Contract Error',
    })
  })
  it('can validate declared response headers at runtime', async () => {
    const { defineEndpointContract, defineEndpointHandler, respond } =
      await import('./internal-runtime')
    const endpoint = defineEndpointContract(
      {
        responses: {
          200: { body: strictUserResponse, headers: { 'X-Request-Id': requestIdHeader } },
        },
      },
      { validation: { response: true } },
    )
    const compliant = defineEndpointHandler(endpoint, () =>
      respond(200, { id: 1, name: 'Tom' }, { headers: { 'x-request-id': 'req-1' } }),
    )
    const event = createEvent({})
    await expect(compliant(event)).resolves.toEqual({ id: 1, name: 'Tom' })
    // Declaring the header in `X-Request-Id` and sending it as `x-request-id`
    // is the same header, so casing must not decide the outcome.
    expect(event.res.headers.get('x-request-id')).toBe('req-1')
    const missing = defineEndpointHandler(endpoint, () => respond(200, { id: 1, name: 'Tom' }))
    await expect(missing(createEvent({}))).rejects.toMatchObject({
      status: 500,
      statusText: 'Response Contract Error',
      data: {
        status: 200,
        source: 'headers',
        issues: [{ path: ['X-Request-Id'], message: 'Invalid request id header' }],
      },
    })
    const wrongValue = defineEndpointHandler(endpoint, () =>
      respond(200, { id: 1, name: 'Tom' }, { headers: { 'x-request-id': 'nope' } }),
    )
    await expect(wrongValue(createEvent({}))).rejects.toMatchObject({
      status: 500,
      statusText: 'Response Contract Error',
      data: { status: 200, source: 'headers' },
    })
  })
  it('reads declared response headers off a returned native Response', async () => {
    const { defineEndpointContract, defineEndpointHandler, respond } =
      await import('./internal-runtime')
    const endpoint = defineEndpointContract(
      {
        responses: {
          200: { media: 'text/csv', headers: { 'X-Request-Id': requestIdHeader } },
        },
      },
      { validation: { response: true } },
    )
    // The Response carries these headers to the wire itself, so validating only
    // the record the endpoint computed would fail a compliant media route.
    const onResponse = defineEndpointHandler(endpoint, () =>
      respond(200, new Response('id\n1\n', { headers: { 'x-request-id': 'req-9' } })),
    )
    await expect(onResponse(createEvent({}))).resolves.toBeInstanceOf(Response)
    const withoutHeader = defineEndpointHandler(endpoint, () => respond(200, new Response('id\n')))
    await expect(withoutHeader(createEvent({}))).rejects.toMatchObject({
      status: 500,
      statusText: 'Response Contract Error',
      data: { status: 200, source: 'headers' },
    })
  })
  it('rejects the removed singular `response` contract with a migration hint', async () => {
    const { defineEndpointContract, defineEndpoint } = await import('./internal-runtime')
    // TypeScript already rejects the key as an excess property, but discovery
    // jiti-evaluates plain JS route modules too, so the removal is enforced at
    // definition time as well.
    expect(() =>
      defineEndpointContract({
        response: userResponse,
      } as never),
    ).toThrow('The `response` contract was removed; declare `responses: { 200: … }` instead.')
    expect(() =>
      defineEndpoint({
        response: userResponse,
        handler: () => ({ id: 1, name: 'Tom' }),
      } as never),
    ).toThrow(/request schemas under `request` and status responses under `responses`/)
  })
  it.each([
    ['params', numberParams],
    ['validate', { body: userResponse }],
  ] as const)(
    'rejects removed route authoring property %s for JavaScript callers',
    async (key, value) => {
      const { defineEndpoint } = await import('./internal-runtime')
      expect(() =>
        defineEndpoint({ [key]: value, handler: () => ({ ok: true }) } as never),
      ).toThrow(/request schemas under `request` and status responses under `responses`/)
    },
  )
  it('rejects endpoint names that cannot become safe client properties', async () => {
    const { defineEndpoint } = await import('./internal-runtime')
    expect(() =>
      defineEndpoint({ name: 'not-valid', handler: () => ({ ok: true }) } as never),
    ).toThrow(/valid JavaScript identifier/)
    expect(() => defineEndpoint({ name: 'then', handler: () => ({ ok: true }) } as never)).toThrow(
      /reserved by \$endpoint/,
    )
    expect(() =>
      defineEndpoint({
        name: 'users',
        get: { handler: () => ({ ok: true }) },
      } as never),
    ).toThrow(/method-group endpoint cannot declare a root name/)
  })
  it.each([
    ['storage', (): undefined => undefined],
    ['scope', (): string => 'public'],
    ['authorization', 'middleware'],
    ['fingerprint', (): Record<string, never> => ({})],
    ['replayStatuses', [409]],
    ['leaseTtlMs', 1000],
    ['replayTtlMs', 1000],
  ] as const)(
    'rejects runtime-only idempotency option %s in a route contract',
    async (key, value) => {
      const { defineEndpoint } = await import('./internal-runtime')
      const metadata = { enabled: true, headerName: 'Idempotency-Key', required: true }
      expect(() =>
        defineEndpoint({
          idempotency: { ...metadata, [key]: value },
          handler: () => ({ ok: true }),
        } as never),
      ).toThrow(new RegExp(`Runtime-only idempotency option.*${key}`))
    },
  )
  it('normalizes route idempotency authoring input and rejects disabled JS forms', async () => {
    const { defineEndpoint } = await import('./internal-runtime')
    const direct = defineEndpoint({
      request: {
        body: userResponse,
      },
      idempotency: true,
      handler: () => ({ id: 1, name: 'Tom' }),
    }) as unknown as {
      __endpoint_contract__: {
        definition: import('./internal-runtime').EndpointDefinition
      }
    }
    const grouped = defineEndpoint({
      post: {
        request: {
          body: userResponse,
        },
        idempotency: { headerName: 'X-Request-Key' },
        handler: () => ({ id: 1, name: 'Tom' }),
      },
    }) as unknown as {
      __endpoint_contracts__: Record<
        string,
        {
          definition: import('./internal-runtime').EndpointDefinition
        }
      >
    }
    expect(direct.__endpoint_contract__.definition.idempotency).toEqual({
      enabled: true,
      headerName: 'Idempotency-Key',
      required: true,
    })
    expect(grouped.__endpoint_contracts__.post.definition.idempotency).toEqual({
      enabled: true,
      headerName: 'X-Request-Key',
      required: true,
    })
    expect(() =>
      defineEndpoint({ idempotency: false, handler: () => ({ ok: true }) } as never),
    ).toThrow(/omit the property to disable/i)
    expect(() =>
      defineEndpoint({
        idempotency: { enabled: false },
        handler: () => ({ ok: true }),
      } as never),
    ).toThrow(/enabled can only be true/i)
  })
  it('rejects runtime-only idempotency options in method route contracts', async () => {
    const { defineEndpoint } = await import('./internal-runtime')
    const metadata = { enabled: true, headerName: 'Idempotency-Key', required: true }
    expect(() =>
      defineEndpoint({
        post: {
          idempotency: { ...metadata, storage: () => undefined },
          handler: () => ({ ok: true }),
        },
      } as never),
    ).toThrow(/Runtime-only idempotency option.*storage/)
  })
  it('rejects a declared response that mixes media with body', async () => {
    const { defineEndpointContract } = await import('./internal-runtime')
    expect(() =>
      defineEndpointContract({
        responses: {
          200: { media: 'text/csv', body: userResponse } as never,
        },
      }),
    ).toThrow(/declares both media and body/)
  })
  it('rejects a declared media list with no media types in it', async () => {
    const { defineEndpointContract } = await import('./internal-runtime')
    expect(() =>
      defineEndpointContract({
        responses: {
          200: { media: [] },
        },
      }),
    ).toThrow(/empty list of media types/)
  })
  it('rejects a declared media list containing an empty media type', async () => {
    const { defineEndpointContract } = await import('./internal-runtime')
    expect(() =>
      defineEndpointContract({
        responses: {
          200: { media: ['text/csv', ''] },
        },
      }),
    ).toThrow(/declares an empty media type/)
  })
  it('rejects a media type that is not a single lowercase type/subtype', async () => {
    const { defineEndpointContract } = await import('./internal-runtime')
    // A comma-joined string is an easy typo now that the array form exists,
    // and would otherwise be sent verbatim as one Content-Type.
    expect(() =>
      defineEndpointContract({ responses: { 200: { media: 'text/csv, application/json' } } }),
    ).toThrow(/not a single type\/subtype media type/)
    // Without the shape check these reach the runtime and negotiate to
    // nothing, so every request to the endpoint would answer 406.
    expect(() =>
      defineEndpointContract({ responses: { 200: { media: ['csv', 'json'] } } }),
    ).toThrow(/not a single type\/subtype media type/)
    expect(() => defineEndpointContract({ responses: { 200: { media: 'TEXT/CSV' } } })).toThrow(
      /must be lowercase/,
    )
    expect(() => defineEndpointContract({ responses: { 200: { media: ' text/csv' } } })).toThrow(
      /must be lowercase and free of surrounding whitespace/,
    )
  })
  it('rejects one schema shared by several media types', async () => {
    const { defineEndpointContract } = await import('./internal-runtime')
    const { z } = await import('zod')
    expect(() =>
      defineEndpointContract({
        responses: {
          200: { media: ['text/csv', 'application/json'], schema: z.object({ id: z.string() }) },
        },
      }),
    ).toThrow(/One schema cannot describe them all/)
    // A single media type still takes a bare schema: there is nothing ambiguous
    // about which representation it documents.
    expect(() =>
      defineEndpointContract({
        responses: { 200: { media: 'application/x-ndjson', schema: z.object({ id: z.string() }) } },
      }),
    ).not.toThrow()
  })
  it('rejects a schema keyed by a media type the response does not declare', async () => {
    const { defineEndpointContract } = await import('./internal-runtime')
    const { z } = await import('zod')
    expect(() =>
      defineEndpointContract({
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
    const { defineEndpointContract } = await import('./internal-runtime')
    expect(() =>
      defineEndpointContract({ responses: { 200: { media: ['text/csv', 'text/csv'] } } }),
    ).toThrow(/declares media type "text\/csv" more than once/)
  })
  it('rejects a declared contentType that is not a string', async () => {
    const { defineEndpointContract } = await import('./internal-runtime')
    expect(() =>
      defineEndpointContract({
        responses: {
          200: { body: userResponse, contentType: 123 as never },
        },
      }),
    ).toThrow(/declares a contentType that is not a string/)
  })
  it('rejects a non-JSON contentType on a validated body', async () => {
    const { defineEndpointContract } = await import('./internal-runtime')
    expect(() =>
      defineEndpointContract({
        responses: {
          200: { body: userResponse, contentType: 'text/csv' },
        },
      }),
    ).toThrow(/on a validated body, which is always sent as JSON/)
    expect(() =>
      defineEndpointContract({
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
