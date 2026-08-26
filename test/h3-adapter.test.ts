import { createApp, toWebHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineEndpoint, defineEndpointHandler } from '../src/runtime'
import {
  defineRuntimeHandler,
  getRuntimeQuery,
  getRuntimeRequestHeaders,
} from '../src/runtime/h3-adapter'

// These run a real HTTP request through a real H3 app instead of a mocked
// event, so they pin the request-parsing semantics the adapter depends on.
// The adapter is the seam that gets rewritten for H3 v2, and several of these
// behaviors differ between plausible v2 replacements: `event.url.searchParams`
// drops repeated query values, and `event.req.headers` is a `Headers` instance
// rather than the plain record the contract layer expects.
async function requestThroughH3(
  handler: ReturnType<typeof defineRuntimeHandler>,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const app = createApp()
  app.use(handler as never)
  return toWebHandler(app)(new Request(url, init))
}

describe('h3 adapter request parsing', () => {
  it('parses repeated query parameters into arrays', async () => {
    const handler = defineRuntimeHandler((event) => getRuntimeQuery(event))

    const response = await requestThroughH3(handler, 'http://test.local/?tag=a&tag=b&q=nuxt')

    await expect(response.json()).resolves.toEqual({ tag: ['a', 'b'], q: 'nuxt' })
  })

  it('parses a single query parameter as a string', async () => {
    const handler = defineRuntimeHandler((event) => getRuntimeQuery(event))

    const response = await requestThroughH3(handler, 'http://test.local/?tag=a')

    await expect(response.json()).resolves.toEqual({ tag: 'a' })
  })

  it('exposes request headers as a plain lowercase record', async () => {
    const handler = defineRuntimeHandler((event) => getRuntimeRequestHeaders(event))

    const response = await requestThroughH3(handler, 'http://test.local/', {
      headers: { 'X-Request-Id': 'abc' },
    })

    await expect(response.json()).resolves.toMatchObject({ 'x-request-id': 'abc' })
  })
})

describe('endpoint query contracts over real requests', () => {
  it('validates repeated query parameters against an array schema', async () => {
    const endpoint = defineEndpoint({
      query: z.object({
        tag: z.array(z.string()),
        limit: z.coerce.number(),
      }),
      responses: { 200: z.object({ tags: z.array(z.string()), limit: z.number() }) },
    })
    const handler = defineEndpointHandler(endpoint, ({ query }) => ({
      tags: query.tag,
      limit: query.limit,
    }))

    const response = await requestThroughH3(
      handler as never,
      'http://test.local/?tag=a&tag=b&limit=10',
    )

    await expect(response.json()).resolves.toEqual({ tags: ['a', 'b'], limit: 10 })
  })
})

describe('media-type-map body contracts over real requests', () => {
  function uploadEndpoint() {
    return defineEndpoint({
      operation: 'upload',
      body: {
        'application/json': z.object({ name: z.string() }),
        'application/x-www-form-urlencoded': z.object({ name: z.string() }),
        'multipart/form-data': z.object({
          name: z.string(),
          tag: z.array(z.string()),
        }),
        'text/plain': z.string(),
      },
    })
  }

  it('parses a real multipart/form-data request, collapsing repeated fields into arrays', async () => {
    const handler = defineEndpointHandler(uploadEndpoint(), ({ body, bodyMediaType }) => ({
      body,
      bodyMediaType,
    }))

    const formData = new FormData()
    formData.append('name', 'Tom')
    formData.append('tag', 'a')
    formData.append('tag', 'b')

    const response = await requestThroughH3(handler as never, 'http://test.local/upload', {
      method: 'POST',
      body: formData,
    })

    await expect(response.json()).resolves.toEqual({
      bodyMediaType: 'multipart/form-data',
      body: { name: 'Tom', tag: ['a', 'b'] },
    })
  })

  it('parses a real application/x-www-form-urlencoded request', async () => {
    const handler = defineEndpointHandler(uploadEndpoint(), ({ body, bodyMediaType }) => ({
      body,
      bodyMediaType,
    }))

    const response = await requestThroughH3(handler as never, 'http://test.local/upload', {
      method: 'POST',
      body: new URLSearchParams({ name: 'Tom' }),
    })

    await expect(response.json()).resolves.toEqual({
      bodyMediaType: 'application/x-www-form-urlencoded',
      body: { name: 'Tom' },
    })
  })

  it('parses a real text/plain request as raw text', async () => {
    const handler = defineEndpointHandler(uploadEndpoint(), ({ body, bodyMediaType }) => ({
      body,
      bodyMediaType,
    }))

    const response = await requestThroughH3(handler as never, 'http://test.local/upload', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '123',
    })

    await expect(response.json()).resolves.toEqual({
      bodyMediaType: 'text/plain',
      body: '123',
    })
  })

  it('responds 415 for a real request whose Content-Type matches no declared member', async () => {
    const handler = defineEndpointHandler(uploadEndpoint(), ({ body }) => ({ body }))

    const response = await requestThroughH3(handler as never, 'http://test.local/upload', {
      method: 'POST',
      headers: { 'content-type': 'text/html' },
      body: '<p>nope</p>',
    })

    expect(response.status).toBe(415)
    await expect(response.json()).resolves.toMatchObject({
      statusMessage: 'Unsupported Media Type',
      data: { received: 'text/html' },
    })
  })
})
