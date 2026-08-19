import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import type { StandardSchemaLike } from '../src/runtime'

const setResponseStatus = vi.fn()
const setHeaders = vi.fn()

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
  beforeEach(() => {
    setResponseStatus.mockClear()
    setHeaders.mockClear()
  })

  it('passes validated request data into the handler', async () => {
    const { defineEndpoint, defineEndpointHandler } = await import('../src/runtime')

    const endpoint = defineEndpoint({
      operation: 'getUser',
      params: numberParams,
      response: userResponse,
    })

    const handler = defineEndpointHandler(endpoint, ({ params }) => {
      return { id: params.id, name: 'Tom' }
    })

    const result = await handler(createEvent({ params: { id: '123' } }))

    expect(result).toEqual({ id: 123, name: 'Tom' })
  })

  it('passes the H3 event, web request, and middleware context into the handler', async () => {
    const { defineEndpoint, defineEndpointHandler } = await import('../src/runtime')

    const endpoint = defineEndpoint({
      operation: 'getCurrentUser',
      response: userResponse,
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
    const { defineEndpoint, defineEndpointHandler } = await import('../src/runtime')

    const endpoint = defineEndpoint({
      operation: 'getUser',
      params: numberParams,
      responses: {
        200: userResponse,
        404: errorResponse,
      },
    })

    const handler = defineEndpointHandler(endpoint, ({ respond }) => {
      return respond(404, { message: 'Not found' }, { headers: { 'x-test': '1' } })
    })

    await expect(handler(createEvent({ params: { id: '123' } }))).resolves.toEqual({
      message: 'Not found',
    })

    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 404)
    expect(setHeaders).toHaveBeenCalledWith(expect.anything(), { 'x-test': '1' })
  })

  it('returns validation errors without exposing an exception stack', async () => {
    const { defineEndpoint, defineEndpointHandler } = await import('../src/runtime')

    const endpoint = defineEndpoint({
      operation: 'getUser',
      params: numberParams,
      response: userResponse,
    })

    const handler = defineEndpointHandler(endpoint, () => {
      return { id: 1, name: 'Tom' }
    })

    await expect(handler(createEvent({ params: { id: 'abc' } }))).resolves.toEqual({
      statusCode: 400,
      statusMessage: 'Validation Error',
      data: {
        params: [{ path: ['id'], message: 'Expected numeric string' }],
      },
    })
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 400, 'Validation Error')
    expect(setHeaders).toHaveBeenCalledWith(expect.anything(), {
      'content-type': 'application/json',
    })
  })

  it('can validate response contracts at runtime', async () => {
    const { defineEndpoint, defineEndpointHandler } = await import('../src/runtime')

    const endpoint = defineEndpoint(
      {
        operation: 'getUser',
        response: strictUserResponse,
      },
      { validation: { response: true } },
    )

    const handler = defineEndpointHandler(endpoint, () => {
      return { id: 'wrong', name: 'Tom' } as any
    })

    await expect(handler(createEvent({}))).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'Response Contract Error',
      data: {
        status: 200,
        issues: [{ message: 'Invalid user response' }],
      },
    })
  })

  it('rejects a declared response that mixes stream: true with body', async () => {
    const { defineEndpoint } = await import('../src/runtime')

    expect(() =>
      defineEndpoint({
        operation: 'exportUsers',
        responses: {
          200: { stream: true, body: userResponse } as never,
        },
      }),
    ).toThrow(/declares both stream: true and body/)
  })

  it('rejects a declared stream contentType that is not a string', async () => {
    const { defineEndpoint } = await import('../src/runtime')

    expect(() =>
      defineEndpoint({
        operation: 'exportUsers',
        responses: {
          200: { stream: true, contentType: 123 as never },
        },
      }),
    ).toThrow(/stream contentType that is not a string/)
  })
})

function createEvent(input: {
  params?: Record<string, string>
  query?: Record<string, unknown>
  body?: unknown
}): H3Event {
  return {
    context: {
      params: input.params,
      query: input.query,
      body: input.body,
    },
    node: {
      req: {
        headers: {},
      },
      res: {},
    },
  } as unknown as H3Event
}
