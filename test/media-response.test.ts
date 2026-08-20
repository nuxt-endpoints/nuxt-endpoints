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
    setHeaders,
    setResponseStatus,
    toWebRequest: () => new Request('http://localhost/test'),
  }
})

function createEvent(input: { params?: Record<string, string>; accept?: string } = {}): H3Event {
  return {
    context: {
      params: input.params,
    },
    node: {
      req: {
        headers: input.accept === undefined ? {} : { accept: input.accept },
      },
      res: {},
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
  beforeEach(() => {
    setResponseStatus.mockClear()
    setHeaders.mockClear()
  })

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

  it('applies the declared media type through setHeaders', async () => {
    const endpoint = defineEndpoint({
      operation: 'exportUsers',
      responses: {
        200: { media: 'text/csv' },
      },
    })
    const stream = createReadableStream()

    const handler = defineEndpointHandler(endpoint, ({ respond }) => respond(200, stream))

    await handler(createEvent())

    expect(setHeaders).toHaveBeenCalledWith(expect.anything(), { 'content-type': 'text/csv' })
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

    await handler(createEvent())

    expect(setHeaders).toHaveBeenCalledWith(expect.anything(), {
      'Content-Type': 'text/csv; charset=utf-8',
    })
    expect(setHeaders).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ 'content-type': 'text/csv' }),
    )
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

    await expect(handler(createEvent())).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'Response Contract Error',
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

    await expect(handler(createEvent())).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'Response Contract Error',
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

    await handler(createEvent())

    expect(setHeaders).toHaveBeenCalledWith(expect.anything(), {
      'content-type': 'application/problem+json',
    })

    const invalidHandler = defineEndpointHandler(endpoint, ({ respond }) =>
      respond(404, { wrong: 'shape' } as never),
    )

    await expect(invalidHandler(createEvent())).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'Response Contract Error',
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

    await handler(createEvent())

    expect(setHeaders).not.toHaveBeenCalled()
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

      const result = await handler(createEvent({ accept: 'application/json' }))

      expect(result).toBe('id,name\n')
      expect(setHeaders).toHaveBeenCalledWith(expect.anything(), { 'content-type': 'text/csv' })
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

      await handler(createEvent({}))

      const headers = setHeaders.mock.calls.at(-1)![1] as Record<string, string>
      expect(headers.vary).toBe('Accept, Accept-Encoding')
      // One header entry, not two spellings of it.
      expect(Object.keys(headers).filter((name) => name.toLowerCase() === 'vary')).toHaveLength(1)
    })

    it('does not repeat Accept when the handler already declared it', async () => {
      const handler = createNegotiator(({ respond }) =>
        respond(200, 'id,name\n', { headers: { vary: 'accept' } }),
      )

      await handler(createEvent({}))

      const headers = setHeaders.mock.calls.at(-1)![1] as Record<string, string>
      expect(headers.vary).toBe('Accept')
    })

    it('varies the refusal too', async () => {
      const handler = createNegotiator(({ respond }) => respond(200, 'id,name\n'))

      const result = await handler(createEvent({ accept: 'application/xml' }))

      expect(result).toMatchObject({ statusCode: 406 })
      const headers = setHeaders.mock.calls.at(-1)![1] as Record<string, string>
      // The 406 is the response a cache must never reuse for a client that
      // accepts something else.
      expect(headers.vary).toBe('Accept')
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

      await handler(createEvent({ accept: 'application/json' }))

      expect(negotiated).toEqual(['application/json'])
      expect(setHeaders).toHaveBeenCalledWith(expect.anything(), {
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

      await handler(createEvent({ accept: 'application/json' }))

      expect(negotiated).toEqual(['text/csv'])
      expect(setHeaders).toHaveBeenCalledWith(expect.anything(), { 'content-type': 'text/csv' })
      expect(setHeaders).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ vary: 'Accept' }),
      )
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

      await handler(createEvent())

      expect(setHeaders).toHaveBeenCalledWith(expect.anything(), { vary: 'Accept' })
    })

    it('answers 406 with the documented body, without ever running the handler', async () => {
      const endpoint = createNegotiatingEndpoint()
      let ran = false

      const handler = defineEndpointHandler(endpoint, ({ respond }) => {
        ran = true
        return respond(200, createReadableStream())
      })

      const result = await handler(createEvent({ accept: 'application/xml' }))

      expect(ran).toBe(false)
      expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 406, 'Not Acceptable')
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

      const result = await handler(createEvent({ accept: 'application/xml' }))

      expect(failures).toEqual([
        expect.objectContaining({
          kind: 'accept',
          source: 'headers',
          received: 'application/xml',
          supportedMediaTypes: ['text/csv', 'application/json'],
        }),
      ])
      expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 415)
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

      await handler(createEvent({ accept: 'text/csv' }))

      expect(setHeaders).toHaveBeenCalledWith(expect.anything(), {
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

      await handler(createEvent({ accept: 'application/json' }))

      expect(setHeaders).toHaveBeenCalledWith(expect.anything(), {
        vary: 'Accept',
        'Content-Type': 'text/csv; charset=utf-8',
      })
    })
  })
})
