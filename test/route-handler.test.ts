import { createApp, createRouter, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as publicRuntime from '../src/runtime'
import { defineRouteHandler } from '../src/runtime'
import type { EndpointRouteEvent } from '../src/runtime'

async function requestRoute(
  handler: Parameters<ReturnType<typeof createRouter>['use']>[1],
  path: string,
  url: string,
  init?: RequestInit,
) {
  const app = createApp()
  const router = createRouter()
  router.use(path, handler)
  app.use(router)
  return toWebHandler(app)(new Request(url, init))
}

describe('canonical defineRouteHandler compatibility adapter', () => {
  it('validates a single-method route and exposes the public route definition', async () => {
    const definition = {
      params: z.object({ id: z.coerce.number() }),
      validate: {
        response: { 200: z.object({ id: z.number() }) },
      },
      handler: (event: EndpointRouteEvent<any>) => ({
        id: (event.validated.params as { id: number }).id,
      }),
    }
    const handler = defineRouteHandler(definition)

    expect(handler['~routeDef']).toBe(definition)
    const response = await requestRoute(handler as never, '/users/:id', 'http://test/users/7')
    await expect(response.json()).resolves.toEqual({ id: 7 })
  })

  it('dispatches the multi-method form through the same public API', async () => {
    const handler = defineRouteHandler({
      get: {
        validate: { response: { 200: z.object({ method: z.literal('get') }) } },
        handler: () => ({ method: 'get' as const }),
      },
      post: {
        validate: {
          body: z.object({ value: z.string() }),
          response: { 201: z.object({ value: z.string() }) },
        },
        handler: (event) => event.respond(201, { value: event.validated.body.value }),
      },
    })

    const get = await requestRoute(handler as never, '/items', 'http://test/items')
    await expect(get.json()).resolves.toEqual({ method: 'get' })

    const post = await requestRoute(handler as never, '/items', 'http://test/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'ok' }),
    })
    expect(post.status).toBe(201)
    await expect(post.json()).resolves.toEqual({ value: 'ok' })
  })

  it('does not publish the legacy authoring functions', () => {
    expect(publicRuntime).not.toHaveProperty('defineEndpoint')
    expect(publicRuntime).not.toHaveProperty('defineEndpointHandler')
    expect(publicRuntime).not.toHaveProperty('defineEndpointMethods')
    expect(publicRuntime).not.toHaveProperty('defineEndpointMethodHandlers')
  })
})
