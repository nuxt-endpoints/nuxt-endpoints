import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import { z } from 'zod'
import type {
  defineEndpoint as DefineEndpoint,
  defineEndpointHandler as DefineEndpointHandler,
} from '../src/runtime'

const setResponseStatus = vi.fn()
const setHeaders = vi.fn()

// '../src/runtime' is imported dynamically in `beforeAll` (rather than
// statically at the top, as endpoint.test.ts also does) because a static
// import would evaluate the h3-adapter -> 'h3' import chain immediately,
// before `setResponseStatus`/`setHeaders` above are assigned — tripping
// Vitest's hoisted `vi.mock` factory into a temporal-dead-zone
// ReferenceError.
let defineEndpoint: typeof DefineEndpoint
let defineEndpointHandler: typeof DefineEndpointHandler

beforeAll(async () => {
  ;({ defineEndpoint, defineEndpointHandler } = await import('../src/runtime'))
})

vi.mock('h3', () => {
  return {
    createError: (error: unknown) => error,
    defineEventHandler: (handler: unknown) => handler,
    getHeaders: (event: H3Event) => event.node.req.headers,
    getQuery: (event: H3Event) => event.context.query || {},
    readBody: async (event: H3Event) => event.context.body || {},
    readFormData: async (event: H3Event) => event.context.formData as FormData,
    readRawBody: async (event: H3Event) => event.context.rawBody as string,
    setHeaders,
    setResponseStatus,
    toWebRequest: () => new Request('http://localhost/test'),
  }
})

function createEvent(input: {
  body?: unknown
  formData?: FormData
  rawBody?: string
  headers?: Record<string, string>
}): H3Event {
  return {
    context: {
      body: input.body,
      formData: input.formData,
      rawBody: input.rawBody,
    },
    node: {
      req: {
        headers: input.headers || {},
      },
      res: {},
    },
  } as unknown as H3Event
}

const UserJson = z.object({ name: z.string() })

describe('single-schema body (regression: unchanged behavior)', () => {
  beforeEach(() => {
    setResponseStatus.mockClear()
    setHeaders.mockClear()
  })

  it('validates the body through the original readRuntimeBody path and leaves bodyMediaType undefined', async () => {
    const endpoint = defineEndpoint({ operation: 'createUser', body: UserJson })
    const handler = defineEndpointHandler(endpoint, ({ body, bodyMediaType }) => {
      expect(bodyMediaType).toBeUndefined()
      return { id: 1, name: body.name }
    })

    await expect(handler(createEvent({ body: { name: 'Tom' } }))).resolves.toEqual({
      id: 1,
      name: 'Tom',
    })
  })

  it('still returns a 400 validation failure shaped like before', async () => {
    const endpoint = defineEndpoint({ operation: 'createUser', body: UserJson })
    const handler = defineEndpointHandler(endpoint, ({ body }) => ({ id: 1, name: body.name }))

    await expect(handler(createEvent({ body: { name: 42 } }))).resolves.toMatchObject({
      statusCode: 400,
      statusMessage: 'Validation Error',
      data: { body: expect.any(Array) },
    })
  })
})

describe('media-type-map body: request-time dispatch', () => {
  beforeEach(() => {
    setResponseStatus.mockClear()
    setHeaders.mockClear()
  })

  const Multipart = z.object({ tag: z.array(z.string()), name: z.string() })
  const Text = z.string()

  function mapEndpoint() {
    return defineEndpoint({
      operation: 'createUpload',
      body: {
        'application/json': UserJson,
        'application/x-www-form-urlencoded': UserJson,
        'multipart/form-data': Multipart,
        'text/plain': Text,
      },
    })
  }

  it('selects the application/json member and reports it as bodyMediaType', async () => {
    const endpoint = mapEndpoint()
    const handler = defineEndpointHandler(endpoint, ({ body, bodyMediaType }) => {
      return { bodyMediaType, body }
    })

    const result = await handler(
      createEvent({ body: { name: 'Tom' }, headers: { 'content-type': 'application/json' } }),
    )

    expect(result).toEqual({ bodyMediaType: 'application/json', body: { name: 'Tom' } })
  })

  it('normalizes a Content-Type with parameters (e.g. charset) before matching', async () => {
    const endpoint = mapEndpoint()
    const handler = defineEndpointHandler(endpoint, ({ bodyMediaType }) => ({ bodyMediaType }))

    const result = await handler(
      createEvent({
        body: { name: 'Tom' },
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
    )

    expect(result).toEqual({ bodyMediaType: 'application/json' })
  })

  it('returns 415 with the documented shape when Content-Type is missing', async () => {
    const endpoint = mapEndpoint()
    const handler = defineEndpointHandler(endpoint, ({ bodyMediaType }) => ({ bodyMediaType }))

    await expect(handler(createEvent({ body: { name: 'Tom' } }))).resolves.toEqual({
      statusCode: 415,
      statusMessage: 'Unsupported Media Type',
      data: {
        message: 'The request Content-Type does not match this endpoint body contract.',
        received: null,
        supportedMediaTypes: [
          'application/json',
          'application/x-www-form-urlencoded',
          'multipart/form-data',
          'text/plain',
        ],
      },
    })
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 415, 'Unsupported Media Type')
  })

  it('returns the usual 400 validation failure when the matched member rejects the body', async () => {
    const endpoint = mapEndpoint()
    const handler = defineEndpointHandler(endpoint, ({ body }) => ({ body }))

    await expect(
      handler(createEvent({ body: { name: 42 }, headers: { 'content-type': 'application/json' } })),
    ).resolves.toMatchObject({
      statusCode: 400,
      statusMessage: 'Validation Error',
      data: { body: expect.any(Array) },
    })
  })
})

describe('media-type-map body: definition-time validation', () => {
  it('rejects an empty media-type map', () => {
    expect(() => defineEndpoint({ body: {} })).toThrow(/must declare at least one media type/)
  })

  it('rejects an uppercase media type key', () => {
    expect(() => defineEndpoint({ body: { 'Application/JSON': UserJson } })).toThrow(
      /must be lowercase/,
    )
  })

  it('rejects a media type key with leading or trailing whitespace', () => {
    expect(() => defineEndpoint({ body: { ' application/json': UserJson } })).toThrow(
      /must not have leading or trailing whitespace/,
    )
  })

  it('rejects an unsupported media type with a message listing the supported ones', () => {
    expect(() => defineEndpoint({ body: { 'application/xml': UserJson } })).toThrow(
      /application\/xml.*not supported.*application\/json/s,
    )
  })

  it('rejects a map member that is not a validator schema', () => {
    expect(() =>
      defineEndpoint({ body: { 'application/json': { not: 'a schema' } as never } }),
    ).toThrow(/must be a validator schema/)
  })

  it('rejects an ambiguous body value that is neither a schema nor a media-type map', () => {
    expect(() => defineEndpoint({ body: 'oops' as never })).toThrow(
      /must be either a validator schema or an object mapping media types/,
    )
  })
})
