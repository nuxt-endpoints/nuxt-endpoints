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

function createEvent(input: { params?: Record<string, string> } = {}): H3Event {
  return {
    context: {
      params: input.params,
    },
    node: {
      req: {
        headers: {},
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

describe('stream response contracts', () => {
  beforeEach(() => {
    setResponseStatus.mockClear()
    setHeaders.mockClear()
  })

  it('passes a returned ReadableStream through untouched, even with response validation enabled', async () => {
    const endpoint = defineEndpoint(
      {
        operation: 'exportUsers',
        responses: {
          200: { stream: true, contentType: 'text/csv' },
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

  it('applies the declared contentType through setHeaders', async () => {
    const endpoint = defineEndpoint({
      operation: 'exportUsers',
      responses: {
        200: { stream: true, contentType: 'text/csv' },
      },
    })
    const stream = createReadableStream()

    const handler = defineEndpointHandler(endpoint, ({ respond }) => respond(200, stream))

    await handler(createEvent())

    expect(setHeaders).toHaveBeenCalledWith(expect.anything(), { 'content-type': 'text/csv' })
  })

  it('defaults to application/octet-stream when the contract declares no contentType', async () => {
    const endpoint = defineEndpoint({
      operation: 'exportUsers',
      responses: {
        200: { stream: true },
      },
    })
    const stream = createReadableStream()

    const handler = defineEndpointHandler(endpoint, ({ respond }) => respond(200, stream))

    await handler(createEvent())

    expect(setHeaders).toHaveBeenCalledWith(expect.anything(), {
      'content-type': 'application/octet-stream',
    })
  })

  it('lets a handler-supplied content-type win over the declared one, case-insensitively', async () => {
    const endpoint = defineEndpoint({
      operation: 'exportUsers',
      responses: {
        200: { stream: true, contentType: 'text/csv' },
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

  it('still validates a non-stream status declared on the same endpoint', async () => {
    const endpoint = defineEndpoint(
      {
        operation: 'exportUsers',
        responses: {
          200: { stream: true, contentType: 'text/csv' },
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

  it('still throws "is not declared" for a stream returned on an undeclared status', async () => {
    const endpoint = defineEndpoint(
      {
        operation: 'exportUsers',
        responses: {
          200: { stream: true, contentType: 'text/csv' },
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
})
