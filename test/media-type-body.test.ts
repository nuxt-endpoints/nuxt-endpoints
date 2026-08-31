import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import { z } from 'zod'
import type {
  defineEndpoint as DefineEndpoint,
  defineEndpointHandler as DefineEndpointHandler,
} from '../src/runtime'

// '../src/runtime' is imported dynamically in `beforeAll` (rather than
// statically at the top, as endpoint.test.ts also does) to keep this test in
// the same shape as before the h3 v2 migration, when a static import would
// have evaluated the platform -> 'h3' import chain before this file's own
// mock state was ready.
let defineEndpoint: typeof DefineEndpoint
let defineEndpointHandler: typeof DefineEndpointHandler

beforeAll(async () => {
  ;({ defineEndpoint, defineEndpointHandler } = await import('../src/runtime'))
})

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

function createEvent(input: {
  body?: unknown
  formData?: FormData
  rawBody?: string
  headers?: Record<string, string>
}): H3Event {
  // A real Request gives .formData()/.text()/.arrayBuffer() for free, so the
  // fixture's raw/form bodies are fed through it rather than hand-rolled.
  const requestInit: RequestInit = { method: 'POST', headers: input.headers || {} }
  if (input.formData) {
    requestInit.body = input.formData
  } else if (input.rawBody !== undefined) {
    requestInit.body = input.rawBody
  }

  return {
    req: new Request('http://localhost/test', requestInit),
    res: { status: 200, statusText: undefined, headers: new Headers() },
    context: {
      body: input.body,
    },
  } as unknown as H3Event
}

const UserJson = z.object({ name: z.string() })

describe('single-schema body (regression: unchanged behavior)', () => {
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

  it('hands an unparsed member to the handler as bytes, unvalidated', async () => {
    const endpoint = defineEndpoint({
      body: {
        'application/json': UserJson,
        'application/pdf': true,
      },
    })
    const handler = defineEndpointHandler(endpoint, ({ body, bodyMediaType }) => ({
      bodyMediaType,
      bytes: [...(body as Uint8Array)],
    }))

    await expect(
      handler(
        createEvent({
          rawBody: '%PDF-1.7',
          headers: { 'content-type': 'application/pdf' },
        }),
      ),
    ).resolves.toEqual({
      bodyMediaType: 'application/pdf',
      bytes: [...new TextEncoder().encode('%PDF-1.7')],
    })
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

    const event = createEvent({ body: { name: 'Tom' } })
    await expect(handler(event)).resolves.toEqual({
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
    expect(event.res.status).toBe(415)
    expect(event.res.statusText).toBe('Unsupported Media Type')
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

  it('rejects a schema on a media type the runtime cannot parse, naming the way out', () => {
    expect(() => defineEndpoint({ body: { 'application/xml': UserJson } })).toThrow(
      /application\/xml.*cannot be validated by a schema.*`true`.*application\/json/s,
    )
  })

  it('accepts any well-formed media type when the member is declared unparsed', () => {
    expect(() => defineEndpoint({ body: { 'application/xml': true } })).not.toThrow()
    expect(() => defineEndpoint({ body: { 'application/pdf': true } })).not.toThrow()
    // The shape check still applies. A key with no `/` at all does not even
    // read as a media-type map, and is rejected by that discrimination first.
    expect(() => defineEndpoint({ body: { 'application/': true } })).toThrow(
      /not a single type\/subtype media type/,
    )
    expect(() => defineEndpoint({ body: { xml: true } })).toThrow(
      /must be either a validator schema or an object mapping media types/,
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
