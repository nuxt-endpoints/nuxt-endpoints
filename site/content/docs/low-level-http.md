---
title: Low-level HTTP
description: Handle files, streams, redirects, proxies, raw Responses, and 204 routes.
---

Nuxt Endpoints is strongest for JSON REST APIs. Use `response` or `responses` when the route returns typed JSON bodies.

For lower-level HTTP behavior, omit `response` and `responses`. The route can still use request validation and the generated path client, but callers should use `.raw()` because the response body is no longer a schema-shaped JSON value.

Response type checking only applies when a route opts into a response contract. If a route needs to return a redirect, a proxy response, or another native `Response` that should not be modelled as a status at all, leave the response contract out and handle the client side as raw HTTP.

Non-JSON bodies are not a reason to leave, though: files, streams, XML, CSV, and event streams all have a [first-class declaration](/docs/endpoints#non-json-responses) that keeps them in the contract without pretending their payload is validated.

```ts
export const endpoint = defineEndpoint({
  params: z.object({ id: z.string() }),
})

export default defineEndpointHandler(endpoint, ({ params }) => {
  return new Response(`raw response for ${params.id}`)
})
```

```ts
const response = await $endpoint('/api/raw/:id', {
  method: 'get',
  params: { id: 'abc' },
}).raw()
const text = await response.text()
```

There is intentionally no `useEndpointRaw`. Native `Response`, `Headers`, and streams do not serialize cleanly into Nuxt async-data payloads.

## File downloads

A download is a media response like any other, so it can stay in the contract:

```ts
// server/api/files/[id].get.ts
export const endpoint = defineEndpoint({
  operation: 'downloadFile',
  params: z.object({ id: z.string() }),
  responses: {
    200: { media: 'application/pdf', description: 'Invoice PDF' },
  },
})

export default defineEndpointHandler(endpoint, async ({ params, respond }) => {
  const file = await loadFile(params.id)

  return respond(200, file.bytes, {
    headers: { 'content-disposition': `attachment; filename="${file.name}"` },
  })
})
```

```ts
const blob = await $endpoint('downloadFile', { params: { id: 'invoice-1' }, responseType: 'blob' })
```

When the content type varies per file and cannot be declared, drop the response contract and return a native `Response` instead, reading the body from `.raw()` on the client.

```ts
// server/api/files/[id].get.ts
export const endpoint = defineEndpoint({
  params: z.object({ id: z.string() }),
})

export default defineEndpointHandler(endpoint, async ({ params }) => {
  const file = await loadFile(params.id)

  return new Response(file.bytes, {
    headers: {
      'content-type': file.contentType,
      'content-disposition': `attachment; filename="${file.name}"`,
    },
  })
})
```

```ts
const response = await $endpoint('/api/files/:id', {
  method: 'get',
  params: { id: 'invoice-1' },
}).raw()
const blob = await response.blob()
const url = URL.createObjectURL(blob)

const link = document.createElement('a')
link.href = url
link.download = 'invoice.pdf'
link.click()
URL.revokeObjectURL(url)
```

## Multipart uploads

Multipart requests are now a first-class contract shape — declare a
`multipart/form-data` member in a [media-type body map](/docs/endpoints#media-type-request-bodies)
to get validation, typing, and OpenAPI output. Drop down to the raw Nuxt event
only when you need streaming part-by-part processing instead of a parsed form.

```ts
// server/api/uploads.post.ts
export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  const file = parts?.find((part) => part.name === 'file')

  if (!file?.data) {
    throw createError({ statusCode: 400, statusMessage: 'Missing file' })
  }

  const uploaded = await saveUpload(file)
  return { id: uploaded.id }
})
```

```ts
const form = new FormData()
form.append('file', file)

const uploaded = await $fetch<{ id: string }>('/api/uploads', {
  method: 'POST',
  body: form,
})
```

This route is outside the generated endpoint client until multipart request contracts become first-class.

## Streaming and SSE

Streaming is no longer a reason to leave the contract. Declare the status by
its [media type](/docs/endpoints#non-json-responses) and the route keeps its
place in OpenAPI and in the generated client, which stops parsing that route's
body so callers receive the live stream.

```ts
// server/api/events.get.ts
export const endpoint = defineEndpoint({
  operation: 'streamEvents',
  responses: {
    200: { media: 'text/event-stream' },
  },
})

export default defineEndpointHandler(endpoint, ({ respond }) => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: ready\n\n'))
    },
  })

  return respond(200, stream, { headers: { 'cache-control': 'no-cache' } })
})
```

```ts
const reader = (await $endpoint('streamEvents')).getReader()
```

An undeclared streaming route still works — return a native `Response` and use
`.raw()`. What it gives up is the OpenAPI entry and the client's knowledge that
the body should not be parsed.

The chunks themselves stay untyped. Declaring their shape would need a complete
chunk, cancellation, and error contract, and the demand in the ecosystem is for
streaming to work at all rather than for typed chunks — so `media` declares
what is sent, and `schema` documents it, without either claiming to check it.

For browser SSE, `EventSource` is usually simpler:

```ts
const events = new EventSource('/api/events')
events.addEventListener('message', (event) => {
  console.log(event.data)
})
```

## Redirects

For API redirects, return a native redirect response. Browser fetch follows redirects by default, so client code usually sees the final response.

```ts
// server/api/auth/callback.get.ts
export const endpoint = defineEndpoint({
  query: z.object({ next: z.string().optional() }),
})

export default defineEndpointHandler(endpoint, ({ query }) => {
  return new Response(null, {
    status: 302,
    headers: {
      location: query.next ?? '/dashboard',
    },
  })
})
```

```ts
const response = await $endpoint('/api/auth/callback', {
  method: 'get',
  query: { next: '/dashboard' },
}).raw()

if (response.redirected) {
  await navigateTo(response.url, { external: true })
}
```

For UI navigation, prefer `navigateTo` directly from the page or middleware instead of hiding navigation behind an API request.

## Proxy routes

Proxy routes are also raw HTTP routes. Return the upstream `Response` and call `.raw()` from the client.

```ts
// server/api/proxy/[id].get.ts
export const endpoint = defineEndpoint({
  params: z.object({ id: z.string() }),
})

export default defineEndpointHandler(endpoint, async ({ params }) => {
  return await fetch(`https://api.example.com/files/${params.id}`)
})
```

```ts
const response = await $endpoint('/api/proxy/:id', {
  method: 'get',
  params: { id: 'asset-1' },
}).raw()
const contentType = response.headers.get('content-type')
const data = await response.arrayBuffer()
```

## Raw Web Responses

Use raw `Response` returns when the route owns status, headers, cookies, or a body shape that should not be modeled as JSON.

```ts
// server/api/report.get.ts
export const endpoint = defineEndpoint({})

export default defineEndpointHandler(endpoint, () => {
  return new Response('created', {
    status: 201,
    headers: {
      'x-report-id': 'report_123',
    },
  })
})
```

```ts
const response = await $endpoint('/api/report', { method: 'get' }).raw()
const reportId = response.headers.get('x-report-id')
const text = await response.text()
```

## 204 No Content

For no-content JSON API routes, keep the response contract. Declare `204` and return it with `respond`.

```ts
// server/api/sessions/current.delete.ts
export const endpoint = defineEndpoint({
  responses: {
    204: z.undefined(),
  },
})

export default defineEndpointHandler(endpoint, ({ respond }) => {
  clearSession()
  return respond(204, undefined)
})
```

```ts
const result = await $endpoint('/api/sessions/current', { method: 'delete' }).result()

if (result.status === 204) {
  result.body // undefined
}
```

Use `.raw()` when the caller only needs the native status:

```ts
const response = await $endpoint('/api/sessions/current', { method: 'delete' }).raw()
response.status // 204
```
