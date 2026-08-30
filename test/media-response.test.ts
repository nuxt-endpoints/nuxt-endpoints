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

vi.mock('h3', () => {
  return {
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

function createEvent(input: { params?: Record<string, string>; accept?: string } = {}): H3Event {
  return {
    req: new Request('http://localhost/test', {
      headers: input.accept === undefined ? undefined : { accept: input.accept },
    }),
    res: { status: 200, statusText: undefined, headers: new Headers() },
    context: {
      params: input.params,
    },
  } as unknown as H3Event
}

function createReadableStream(): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('id,name\n'))
      controller.close()
    },
  })
}

describe('media response contracts', () => {
  it('passes a returned ReadableStream through untouched, even with response validation enabled', async () => {
    const endpoint = defineEndpoint(
      {
        operation: 'exportUsers',
        responses: {
          200: { media: 'text/csv' },
          404: z.object({ message: z.string() }),
        },
      },
      { validation: { response: true } },
    )
    const stream = createReadableStream()

    const handler = defineEndpointHandler(endpoint, ({ respond }) => respond(200, stream))

    const result = await handler(createEvent())

    expect(result).toBe(stream)
  })

  it('lets a handler-supplied content-type win over the declared one, case-insensitively', async () => {
    const endpoint = defineEndpoint({
      operation: 'exportUsers',
      responses: {
        200: { media: 'text/csv' },
      },
    })
    const stream = createReadableStream()

    const handler = defineEndpointHandler(endpoint, ({ respond }) =>
      respond(200, stream, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } }),
    )

    const event = createEvent()
    await handler(event)

    expect(event.res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    // h3 v2's response headers are a Web `Headers`, so there is exactly one
    // content-type entry - the declared 'text/csv' never gets written
    // alongside it.
    expect([...event.res.headers.keys()]).toEqual(['content-type'])
  })

  it('still validates a non-media status declared on the same endpoint', async () => {
    const endpoint = defineEndpoint(
      {
        operation: 'exportUsers',
        responses: {
          200: { media: 'text/csv' },
          404: z.object({ message: z.string() }),
        },
      },
      { validation: { response: true } },
    )

    const handler = defineEndpointHandler(endpoint, ({ respond }) =>
      respond(404, { wrong: 'shape' } as never),
    )

    // h3 v2's error wire shape uses `status`/`statusText`, not v1's
    // `statusCode`/`statusMessage`.
    await expect(handler(createEvent())).rejects.toMatchObject({
      status: 500,
      statusText: 'Response Contract Error',
      data: { status: 404 },
    })
  })

  it('still throws "is not declared" for a media response returned on an undeclared status', async () => {
    const endpoint = defineEndpoint(
      {
        operation: 'exportUsers',
        responses: {
          200: { media: 'text/csv' },
        },
      },
      { validation: { response: true } },
    )
    const stream = createReadableStream()

    const handler = defineEndpointHandler(endpoint, ({ respond }) =>
      respond(201 as never, stream as never),
    )

    // h3 v2's error wire shape uses `status`/`statusText`, not v1's
    // `statusCode`/`statusMessage`.
    await expect(handler(createEvent())).rejects.toMatchObject({
      status: 500,
      statusText: 'Response Contract Error',
      data: {
        status: 201,
        issues: [{ message: 'Response status 201 is not declared' }],
      },
    })
  })

  it('applies a validated contentType of a JSON profile through setHeaders, and still validates the body', async () => {
    const endpoint = defineEndpoint(
      {
        operation: 'getProblem',
        responses: {
          200: z.object({ ok: z.literal(true) }),
          404: {
            body: z.object({ type: z.string(), title: z.string() }),
            contentType: 'application/problem+json',
          },
        },
      },
      { validation: { response: true } },
    )

    const handler = defineEndpointHandler(endpoint, ({ respond }) =>
      respond(404, { type: 'about:blank', title: 'Not Found' }),
    )

    const event = createEvent()
    await handler(event)

    expect(event.res.headers.get('content-type')).toBe('application/problem+json')

    const invalidHandler = defineEndpointHandler(endpoint, ({ respond }) =>
      respond(404, { wrong: 'shape' } as never),
    )

    // h3 v2's error wire shape uses `status`/`statusText`, not v1's
    // `statusCode`/`statusMessage`.
    await expect(invalidHandler(createEvent())).rejects.toMatchObject({
      status: 500,
      statusText: 'Response Contract Error',
      data: { status: 404 },
    })
  })

  it('sets no content-type header for a validated status with no declared contentType', async () => {
    const endpoint = defineEndpoint({
      operation: 'getUser',
      responses: {
        200: z.object({ id: z.number() }),
      },
    })

    const handler = defineEndpointHandler(endpoint, () => ({ id: 1 }))

    const event = createEvent()
    await handler(event)

    expect([...event.res.headers.keys()]).toHaveLength(0)
  })

  describe('Accept negotiation scope', () => {
    it('does not negotiate when each status has one representation of its own', async () => {
      // Two media types exist across the endpoint, but neither status offers a
      // choice, so a request asking for something else must not be refused.
      const endpoint = defineEndpoint({
        responses: {
          200: { media: 'text/csv' },
          404: { media: 'application/problem+json' },
        },
      })
      const handler = defineEndpointHandler(endpoint, ({ responseMediaType, respond }) => {
        expect(responseMediaType).toBe('text/csv')
        return respond(200, 'id,name\n')
      })

      const event = createEvent({ accept: 'application/json' })
      const result = await handler(event)

      expect(result).toBe('id,name\n')
      expect(event.res.headers.get('content-type')).toBe('text/csv')
    })

    it('never negotiates its way into an error status representation', async () => {
      const endpoint = defineEndpoint({
        responses: {
          200: { media: ['text/csv', 'application/json'] },
          404: { media: 'application/problem+json' },
        },
      })
      const handler = defineEndpointHandler(endpoint, ({ respond }) => respond(200, 'id,name\n'))

      // The 404's media type is not on offer, so asking for it is a refusal
      // rather than a 200 mislabelled as problem+json.
      const result = await handler(createEvent({ accept: 'application/problem+json' }))

      expect(result).toMatchObject({ statusCode: 406 })
    })
  })

  describe('Vary', () => {
    function createNegotiator(
      handler: (context: {
        respond: (status: 200, body: unknown, options?: unknown) => unknown
      }) => unknown,
    ) {
      const endpoint = defineEndpoint({
        responses: { 200: { media: ['text/csv', 'application/json'] } },
      })
      return defineEndpointHandler(endpoint, handler as never)
    }

    it('adds Accept to a Vary the handler declared instead of replacing it', async () => {
      const handler = createNegotiator(({ respond }) =>
        respond(200, 'id,name\n', { headers: { Vary: 'Accept-Encoding' } }),
      )

      const event = createEvent({})
      await handler(event)

      expect(event.res.headers.get('vary')).toBe('Accept, Accept-Encoding')
      // One header entry, not two spellings of it - h3 v2's response headers
      // are a Web `Headers`, which folds any duplicate spelling into one key.
      expect([...event.res.headers.keys()].filter((name) => name === 'vary')).toHaveLength(1)
    })

    it('does not repeat Accept when the handler already declared it', async () => {
      const handler = createNegotiator(({ respond }) =>
        respond(200, 'id,name\n', { headers: { vary: 'accept' } }),
      )

      const event = createEvent({})
      await handler(event)

      expect(event.res.headers.get('vary')).toBe('Accept')
    })

    it('varies the refusal too', async () => {
      const handler = createNegotiator(({ respond }) => respond(200, 'id,name\n'))

      const event = createEvent({ accept: 'application/xml' })
      const result = await handler(event)

      expect(result).toMatchObject({ statusCode: 406 })
      // The 406 is the response a cache must never reuse for a client that
      // accepts something else.
      expect(event.res.headers.get('vary')).toBe('Accept')
    })
  })

  describe('Accept negotiation', () => {
    function createNegotiatingEndpoint() {
      return defineEndpoint({
        operation: 'exportUsers',
        responses: {
          200: { media: ['text/csv', 'application/json'] },
        },
      })
    }

    // Which media type wins for a given header is `negotiateMediaType`'s job
    // and is covered in test/accept.test.ts. What the endpoint layer owns is
    // that the result reaches both the handler and the response, so one case
    // proves it - the others differed only in the header string.
    it('hands the negotiated media type to the handler and sends it', async () => {
      const endpoint = createNegotiatingEndpoint()
      const negotiated: (string | undefined)[] = []

      const handler = defineEndpointHandler(endpoint, ({ responseMediaType, respond }) => {
        negotiated.push(responseMediaType)
        return respond(200, createReadableStream())
      })

      const event = createEvent({ accept: 'application/json' })
      await handler(event)

      expect(negotiated).toEqual(['application/json'])
      expect(Object.fromEntries(event.res.headers.entries())).toEqual({
        vary: 'Accept',
        'content-type': 'application/json',
      })
    })

    it('still reports the single declared media type without varying on Accept', async () => {
      const endpoint = defineEndpoint({
        operation: 'exportUsers',
        responses: {
          200: { media: 'text/csv' },
        },
      })
      const negotiated: (string | undefined)[] = []

      const handler = defineEndpointHandler(endpoint, ({ responseMediaType, respond }) => {
        negotiated.push(responseMediaType)
        return respond(200, createReadableStream())
      })

      const event = createEvent({ accept: 'application/json' })
      await handler(event)

      expect(negotiated).toEqual(['text/csv'])
      expect(event.res.headers.get('content-type')).toBe('text/csv')
      expect(event.res.headers.get('vary')).toBeNull()
    })

    it('varies on Accept for every status of a negotiating endpoint, validated ones included', async () => {
      const endpoint = defineEndpoint({
        operation: 'exportUsers',
        responses: {
          200: { media: ['text/csv', 'application/json'] },
          404: z.object({ message: z.string() }),
        },
      })

      const handler = defineEndpointHandler(endpoint, ({ respond }) =>
        respond(404, { message: 'Not found' }),
      )

      const event = createEvent()
      await handler(event)

      expect(event.res.headers.get('vary')).toBe('Accept')
    })

    it('answers 406 with the documented body, without ever running the handler', async () => {
      const endpoint = createNegotiatingEndpoint()
      let ran = false

      const handler = defineEndpointHandler(endpoint, ({ respond }) => {
        ran = true
        return respond(200, createReadableStream())
      })

      const event = createEvent({ accept: 'application/xml' })
      const result = await handler(event)

      expect(ran).toBe(false)
      expect(event.res.status).toBe(406)
      expect(event.res.statusText).toBe('Not Acceptable')
      expect(result).toEqual({
        statusCode: 406,
        statusMessage: 'Not Acceptable',
        data: {
          message: 'This endpoint cannot produce any media type the request accepts.',
          received: 'application/xml',
          supportedMediaTypes: ['text/csv', 'application/json'],
        },
      })
    })

    it('routes the refusal through the endpoint onValidationError hook', async () => {
      const failures: unknown[] = []
      const endpoint = defineEndpoint(
        {
          operation: 'exportUsers',
          responses: {
            200: { media: ['text/csv', 'application/json'] },
          },
        },
        {
          onValidationError: (failure) => {
            failures.push(failure)
            return failure.kind === 'accept'
              ? { status: 415, body: { claimed: true, of: failure.supportedMediaTypes } }
              : undefined
          },
        },
      )

      const handler = defineEndpointHandler(endpoint, ({ respond }) =>
        respond(200, createReadableStream()),
      )

      const event = createEvent({ accept: 'application/xml' })
      const result = await handler(event)

      expect(failures).toEqual([
        expect.objectContaining({
          kind: 'accept',
          source: 'headers',
          received: 'application/xml',
          supportedMediaTypes: ['text/csv', 'application/json'],
        }),
      ])
      expect(event.res.status).toBe(415)
      expect(result).toEqual({ claimed: true, of: ['text/csv', 'application/json'] })
    })

    it('keeps a status that does not offer the negotiated type on its own declared media type', async () => {
      const endpoint = defineEndpoint({
        operation: 'exportUsers',
        responses: {
          200: { media: ['text/csv', 'application/json'] },
          404: {
            body: z.object({ type: z.string(), title: z.string() }),
            contentType: 'application/problem+json',
          },
        },
      })

      const handler = defineEndpointHandler(endpoint, ({ responseMediaType, respond }) => {
        expect(responseMediaType).toBe('text/csv')
        return respond(404, { type: 'about:blank', title: 'Not Found' })
      })

      const event = createEvent({ accept: 'text/csv' })
      await handler(event)

      expect(Object.fromEntries(event.res.headers.entries())).toEqual({
        vary: 'Accept',
        'content-type': 'application/problem+json',
      })
    })

    it('lets a handler-supplied content-type win over the negotiated one', async () => {
      const endpoint = createNegotiatingEndpoint()

      const handler = defineEndpointHandler(endpoint, ({ respond }) =>
        respond(200, createReadableStream(), {
          headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        }),
      )

      const event = createEvent({ accept: 'application/json' })
      await handler(event)

      expect(Object.fromEntries(event.res.headers.entries())).toEqual({
        vary: 'Accept',
        'content-type': 'text/csv; charset=utf-8',
      })
    })
  })
})
