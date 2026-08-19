import { createApp, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineEndpoint, defineEndpointRuntime } from '../src/runtime'
import type { EndpointRuntime } from '../src/runtime'

async function request(handler: unknown, url: string, init?: RequestInit): Promise<Response> {
  const app = createApp()
  app.use(handler as never)
  return toWebHandler(app)(new Request(url, init))
}

const query = z.object({ page: z.coerce.number() })

describe('endpoint-level onValidationError', () => {
  it('shapes a schema failure', async () => {
    const endpoint = defineEndpoint(
      { query },
      {
        onValidationError: ({ kind, source }) => ({
          status: 422,
          body: { envelope: true, kind, source },
        }),
      },
    )

    const response = await request(
      endpoint.handler(() => ({ ok: true })),
      'http://t.local/?page=x',
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      envelope: true,
      kind: 'schema',
      source: 'query',
    })
  })

  it('shapes a media-type failure with the declared members', async () => {
    const endpoint = defineEndpoint(
      { body: { 'application/json': z.object({ a: z.string() }) } },
      {
        onValidationError: (failure) =>
          failure.kind === 'media-type'
            ? { status: 400, body: { received: failure.received, of: failure.supportedMediaTypes } }
            : undefined,
      },
    )

    const response = await request(
      endpoint.handler(() => ({ ok: true })),
      'http://t.local/',
      {
        method: 'POST',
        headers: { 'content-type': 'text/html' },
        body: 'x',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      received: 'text/html',
      of: ['application/json'],
    })
  })

  it('falls back to the default shape when the handler returns nothing', async () => {
    const endpoint = defineEndpoint({ query }, { onValidationError: () => undefined })

    const response = await request(
      endpoint.handler(() => ({ ok: true })),
      'http://t.local/?page=x',
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ statusMessage: 'Validation Error' })
  })
})

describe('application-level validation error handler', () => {
  const appRuntime: EndpointRuntime = defineEndpointRuntime({
    onValidationError: ({ source }) => ({ status: 418, body: { app: true, source } }),
  })

  it('applies to an endpoint that declares none', async () => {
    const endpoint = defineEndpoint({ query })
    const handler = endpoint.handler(() => ({ ok: true }))
    handler.__set_endpoint_runtime__(appRuntime)

    const response = await request(handler, 'http://t.local/?page=x')

    expect(response.status).toBe(418)
    await expect(response.json()).resolves.toEqual({ app: true, source: 'query' })
  })

  it('loses to the endpoint handler, and takes over when it declines', async () => {
    const endpoint = defineEndpoint(
      { query, headers: z.object({ 'x-tenant': z.string() }) },
      {
        onValidationError: ({ source }) =>
          source === 'query' ? { status: 422, body: { from: 'endpoint' } } : undefined,
      },
    )
    const handler = endpoint.handler(() => ({ ok: true }))
    handler.__set_endpoint_runtime__(appRuntime)

    const claimed = await request(handler, 'http://t.local/?page=x')
    expect(claimed.status).toBe(422)
    await expect(claimed.json()).resolves.toEqual({ from: 'endpoint' })

    const declined = await request(handler, 'http://t.local/?page=1')
    expect(declined.status).toBe(418)
    await expect(declined.json()).resolves.toEqual({ app: true, source: 'headers' })
  })
})

describe('defineEndpointRuntime', () => {
  it('rejects a non-object', () => {
    expect(() => defineEndpointRuntime(null as never)).toThrow(/expects an object/i)
  })

  it('rejects a hook that is not a function', () => {
    expect(() => defineEndpointRuntime({ wrapHandler: 'x' as never })).toThrow(
      /must be a function/i,
    )
  })

  it('rejects a malformed openApi section', () => {
    expect(() => defineEndpointRuntime({ openApi: 'x' as never })).toThrow(
      /"openApi" must be an object/,
    )
    expect(() => defineEndpointRuntime({ openApi: { document: 'x' as never } })).toThrow(
      /"openApi.document" must be an object/,
    )
    expect(() => defineEndpointRuntime({ openApi: { extend: 'x' as never } })).toThrow(
      /"openApi.extend" must be a function/,
    )
  })
})

describe('wrapHandler', () => {
  it('wraps the handler and can answer without running it', async () => {
    const calls: string[] = []
    const endpoint = defineEndpoint(
      {},
      {
        wrapHandler: async (_context, next) => {
          calls.push('before')
          const response = await next()
          calls.push('after')
          return { ...response, headers: { ...response.headers, 'x-wrapped': '1' } }
        },
      },
    )

    const response = await request(
      endpoint.handler(() => {
        calls.push('handler')
        return { ok: true }
      }),
      'http://t.local/',
    )

    expect(calls).toEqual(['before', 'handler', 'after'])
    expect(response.headers.get('x-wrapped')).toBe('1')
  })

  it('skips the handler when the wrapper does not call next', async () => {
    let ran = false
    const endpoint = defineEndpoint(
      {},
      {
        wrapHandler: async () => ({
          status: 202,
          body: { substituted: true },
          explicitStatus: true,
        }),
      },
    )

    const response = await request(
      endpoint.handler(() => {
        ran = true
        return { ok: true }
      }),
      'http://t.local/',
    )

    expect(ran).toBe(false)
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({ substituted: true })
  })

  it('runs the application wrapper outside the endpoint one', async () => {
    const order: string[] = []
    const endpoint = defineEndpoint(
      {},
      {
        wrapHandler: async (_context, next) => {
          order.push('endpoint:in')
          const response = await next()
          order.push('endpoint:out')
          return response
        },
      },
    )
    const handler = endpoint.handler(() => {
      order.push('handler')
      return { ok: true }
    })
    handler.__set_endpoint_runtime__(
      defineEndpointRuntime({
        wrapHandler: async (_context, next) => {
          order.push('app:in')
          const response = await next()
          order.push('app:out')
          return response
        },
      }),
    )

    await request(handler, 'http://t.local/')

    expect(order).toEqual(['app:in', 'endpoint:in', 'handler', 'endpoint:out', 'app:out'])
  })

  it('sees a thrown handler through try/finally', async () => {
    const cleanup: string[] = []
    const endpoint = defineEndpoint(
      {},
      {
        wrapHandler: async (_context, next) => {
          try {
            return await next()
          } finally {
            cleanup.push('released')
          }
        },
      },
    )

    await request(
      endpoint.handler(() => {
        throw new Error('boom')
      }),
      'http://t.local/',
    )

    expect(cleanup).toEqual(['released'])
  })
})
