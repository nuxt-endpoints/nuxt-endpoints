import { H3 } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createMemoryIdempotencyStorage,
  defineEndpoint,
  defineEndpointMethodHandlers,
  defineEndpointMethods,
} from '../src/runtime'
import { defineRuntimeHandler } from '../src/runtime/platform'

// These run a real HTTP request through a real H3 app (router included, since
// the dispatcher depends on `event.context.params` populated by route
// matching) instead of a mocked event — dispatch, HEAD, and OPTIONS are real
// h3 behaviors, not something a mocked event could honestly stand in for.
async function requestThroughH3(
  handler: ReturnType<typeof defineRuntimeHandler>,
  routePath: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const app = new H3()
  // `app.all()` registers the handler for every HTTP method on this path, so
  // each one reaches the dispatcher itself instead of h3 short-circuiting on
  // method lookup.
  //
  // Built through the v2 `H3` class rather than the `createApp`/`createRouter`
  // shims: those still exist on v2 but no longer populate
  // `event.context.params` from route matching, which is the whole reason this
  // helper builds a real app. The shims answer `{}` where `new H3()` answers
  // `{ id: '7' }`.
  app.all(routePath, handler as never)
  return app.fetch(new Request(url, init))
}

function userEndpoints() {
  return defineEndpointMethods({
    get: defineEndpoint({
      params: z.object({ id: z.coerce.number() }),
      responses: { 200: z.object({ id: z.number(), name: z.string() }) },
    }),
    put: defineEndpoint({
      params: z.object({ id: z.coerce.number() }),
      body: z.object({ name: z.string() }),
      responses: {
        200: z.object({ id: z.number(), name: z.string() }),
        404: z.object({ message: z.string() }),
      },
    }),
  })
}

describe('defineEndpointMethods dispatch over real requests', () => {
  it('routes GET and PUT requests to their own handler, with params/body validation applied', async () => {
    const endpoints = userEndpoints()
    const handler = defineEndpointMethodHandlers(endpoints, {
      get: ({ params }) => ({ id: params.id, name: `user-${params.id}` }),
      put: ({ params, body, respond }) => respond(200, { id: params.id, name: body.name }),
    })

    const getResponse = await requestThroughH3(
      handler as never,
      '/users/:id',
      'http://test.local/users/7',
    )
    await expect(getResponse.json()).resolves.toEqual({ id: 7, name: 'user-7' })

    const putResponse = await requestThroughH3(
      handler as never,
      '/users/:id',
      'http://test.local/users/7',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Tom' }),
      },
    )
    await expect(putResponse.json()).resolves.toEqual({ id: 7, name: 'Tom' })
  })

  it('lets a declared-responses member respond with a non-200 status through the group dispatcher', async () => {
    const endpoints = userEndpoints()
    const handler = defineEndpointMethodHandlers(endpoints, {
      get: ({ params }) => ({ id: params.id, name: `user-${params.id}` }),
      put: ({ respond }) => respond(404, { message: 'not found' }),
    })

    const response = await requestThroughH3(
      handler as never,
      '/users/:id',
      'http://test.local/users/7',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Tom' }),
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ message: 'not found' })
  })

  it('responds 405 with an Allow header for an undeclared method', async () => {
    const endpoints = userEndpoints()
    const handler = defineEndpointMethodHandlers(endpoints, {
      get: () => ({ id: 1, name: 'Tom' }),
      put: ({ respond }) => respond(404, { message: 'not found' }),
    })

    const response = await requestThroughH3(
      handler as never,
      '/users/:id',
      'http://test.local/users/7',
      { method: 'DELETE' },
    )

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD, OPTIONS, PUT')
    await expect(response.json()).resolves.toEqual({
      statusCode: 405,
      statusMessage: 'Method Not Allowed',
      data: { allow: ['GET', 'HEAD', 'OPTIONS', 'PUT'] },
    })
  })

  it('answers HEAD with the GET status/content-type and no body', async () => {
    const endpoints = userEndpoints()
    const handler = defineEndpointMethodHandlers(endpoints, {
      get: ({ params }) => ({ id: params.id, name: `user-${params.id}` }),
      put: ({ respond }) => respond(404, { message: 'not found' }),
    })

    const getResponse = await requestThroughH3(
      handler as never,
      '/users/:id',
      'http://test.local/users/7',
    )
    const headResponse = await requestThroughH3(
      handler as never,
      '/users/:id',
      'http://test.local/users/7',
      { method: 'HEAD' },
    )

    expect(headResponse.status).toBe(getResponse.status)
    expect(headResponse.headers.get('content-type')).toBe(getResponse.headers.get('content-type'))
    await expect(headResponse.text()).resolves.toBe('')
  })

  it('responds 405 to HEAD when the group has no GET member', async () => {
    const endpoints = defineEndpointMethods({
      post: defineEndpoint({ body: z.object({ name: z.string() }) }),
    })
    const handler = defineEndpointMethodHandlers(endpoints, {
      post: ({ body }) => ({ created: body.name }),
    })

    const response = await requestThroughH3(
      handler as never,
      '/things',
      'http://test.local/things',
      { method: 'HEAD' },
    )

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('OPTIONS, POST')
  })

  it('answers OPTIONS with 204 and an Allow header, no body', async () => {
    const endpoints = userEndpoints()
    const handler = defineEndpointMethodHandlers(endpoints, {
      get: () => ({ id: 1, name: 'Tom' }),
      put: ({ respond }) => respond(404, { message: 'not found' }),
    })

    const response = await requestThroughH3(
      handler as never,
      '/users/:id',
      'http://test.local/users/7',
      { method: 'OPTIONS' },
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('allow')).toBe('GET, HEAD, OPTIONS, PUT')
    await expect(response.text()).resolves.toBe('')
  })

  it('prefers explicitly declared HEAD and OPTIONS handlers over derived behavior', async () => {
    const endpoints = defineEndpointMethods({
      get: defineEndpoint({ responses: { 200: z.object({ source: z.literal('get') }) } }),
      head: defineEndpoint({ responses: { 202: z.undefined() } }),
      options: defineEndpoint({ responses: { 203: z.undefined() } }),
    })
    const handler = defineEndpointMethodHandlers(endpoints, {
      get: () => ({ source: 'get' as const }),
      head: ({ respond }) => respond(202, undefined),
      options: ({ respond }) => respond(203, undefined),
    })

    const headResponse = await requestThroughH3(
      handler as never,
      '/explicit',
      'http://test.local/explicit',
      { method: 'HEAD' },
    )
    const optionsResponse = await requestThroughH3(
      handler as never,
      '/explicit',
      'http://test.local/explicit',
      { method: 'OPTIONS' },
    )

    expect(headResponse.status).toBe(202)
    expect(optionsResponse.status).toBe(203)
  })
})

describe('defineEndpointMethods route identity and idempotency policy forwarding', () => {
  it('throws when a route identity is attached for a method the group does not declare', () => {
    const endpoints = defineEndpointMethods({
      get: defineEndpoint({ responses: { 200: z.object({ id: z.number() }) } }),
    })
    const handler = defineEndpointMethodHandlers(endpoints, { get: () => ({ id: 1 }) })

    expect(() =>
      (
        handler as never as { __set_endpoint_route__: (identity: unknown) => void }
      ).__set_endpoint_route__({
        method: 'delete',
        routeTemplate: '/api/items',
      }),
    ).toThrow(/only declares/i)
  })

  it('throws when the same method is attached to two different route templates', () => {
    const endpoints = defineEndpointMethods({
      get: defineEndpoint({ responses: { 200: z.object({ id: z.number() }) } }),
    })
    const handler = defineEndpointMethodHandlers(endpoints, { get: () => ({ id: 1 }) })
    const attach = (handler as never as { __set_endpoint_route__: (identity: unknown) => void })
      .__set_endpoint_route__

    attach({ method: 'get', routeTemplate: '/api/items' })
    expect(() => attach({ method: 'get', routeTemplate: '/api/other-items' })).toThrow(
      /multiple route identities/i,
    )
  })

  it('forwards an injected idempotency policy to every sub-handler', async () => {
    const storage = createMemoryIdempotencyStorage()
    const execute = vi.fn()
    const endpoints = defineEndpointMethods({
      put: defineEndpoint({ body: z.object({ name: z.string() }) }).idempotency({ required: true }),
    })
    const handler = defineEndpointMethodHandlers(endpoints, {
      put: ({ body }) => {
        execute()
        return { created: body.name }
      },
    })

    ;(
      handler as never as { __set_endpoint_route__: (identity: unknown) => void }
    ).__set_endpoint_route__({
      method: 'put',
      routeTemplate: '/api/items',
    })
    ;(
      handler as never as {
        __set_endpoint_runtime__: (runtime: unknown) => void
      }
    ).__set_endpoint_runtime__({
      idempotency: {
        storage: () => storage,
        scope: () => 'public',
        authorization: 'middleware',
      },
    })

    const request = () =>
      requestThroughH3(handler as never, '/api/items', 'http://test.local/api/items', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'request-1' },
        body: JSON.stringify({ name: 'Tom' }),
      })

    await expect(request().then((response) => response.json())).resolves.toEqual({
      created: 'Tom',
    })
    await expect(request().then((response) => response.json())).resolves.toEqual({
      created: 'Tom',
    })
    expect(execute).toHaveBeenCalledOnce()
  })
})

describe('defineEndpointMethods definition-time validation', () => {
  it('rejects an empty methods map', () => {
    expect(() => defineEndpointMethods({})).toThrow(TypeError)
  })

  it('accepts the full method set recognized by the Nitro route-contract macro', () => {
    const endpoint = defineEndpoint({ responses: { 200: z.object({ id: z.number() }) } })
    expect(() =>
      defineEndpointMethods({
        get: endpoint,
        post: endpoint,
        put: endpoint,
        patch: endpoint,
        delete: endpoint,
        head: endpoint,
        options: endpoint,
        connect: endpoint,
        trace: endpoint,
      }),
    ).not.toThrow()
  })

  it('rejects unsupported method keys', () => {
    const endpoint = defineEndpoint({ responses: { 200: z.object({ id: z.number() }) } })
    expect(() => defineEndpointMethods({ fetch: endpoint } as never)).toThrow(TypeError)
  })

  it('rejects a member that is not a DefinedEndpoint', () => {
    expect(() => defineEndpointMethods({ get: { not: 'an endpoint' } } as never)).toThrow(TypeError)
  })

  it('rejects a missing handler', () => {
    const endpoints = defineEndpointMethods({
      get: defineEndpoint({ responses: { 200: z.object({ id: z.number() }) } }),
      put: defineEndpoint({ body: z.object({ name: z.string() }) }),
    })
    expect(() =>
      defineEndpointMethodHandlers(endpoints, { get: () => ({ id: 1 }) } as never),
    ).toThrow(TypeError)
  })

  it('rejects an extra handler not present in the declared methods', () => {
    const endpoints = defineEndpointMethods({
      get: defineEndpoint({ responses: { 200: z.object({ id: z.number() }) } }),
    })
    expect(() =>
      defineEndpointMethodHandlers(endpoints, {
        get: () => ({ id: 1 }),
        put: () => ({ id: 1 }),
      } as never),
    ).toThrow(TypeError)
  })
})
