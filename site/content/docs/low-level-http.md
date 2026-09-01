---
title: Low-level HTTP
description: Handle files, streams, redirects, proxies, raw Responses, and 204 routes.
---

Nuxt Endpoints is strongest for JSON APIs, but the canonical route definition
keeps native HTTP escape hatches.

## Native responses

Omit `validate.response` when the response should not be modelled as a typed
body. Request validation still applies; callers should use `.raw()`.

```ts
export default defineRouteHandler({
  params: z.object({ id: z.string() }),
  handler: ({ params }) => new Response(`raw response for ${params.id}`),
})
```

```ts
const response = await $endpoint('/api/raw/:id', {
  method: 'get',
  params: { id: 'abc' },
}).raw()
const text = await response.text()
```

There is intentionally no `useEndpointRaw`: native `Response`, `Headers`,
and streams do not serialize into Nuxt async-data payloads.

## File downloads

Use a media response when the representation is known:

```ts
export default defineRouteHandler({
  operation: 'downloadFile',
  params: z.object({ id: z.string() }),
  validate: {
    response: {
      200: { media: 'application/pdf', description: 'Invoice PDF' },
    },
  },
  handler: async ({ params, respond }) => {
    const file = await loadFile(params.id)
    return respond(200, file.bytes, {
      headers: { 'content-disposition': `attachment; filename="${file.name}"` },
    })
  },
})
```

```ts
const response = await $endpoint('downloadFile', {
  params: { id: 'invoice-1' },
}).raw()
const blob = await response.blob()
```

When the content type cannot be declared, return a native `Response` and read
it through `.raw()`.

## Multipart and raw uploads

A media-type body map validates parsed representations and can expose raw
bytes for selected members:

```ts
export default defineRouteHandler({
  validate: {
    body: {
      'multipart/form-data': z.object({ name: z.string() }),
      'application/pdf': true,
    },
    response: { 201: z.object({ ok: z.literal(true) }) },
  },
  handler: ({ body, bodyMediaType, respond }) => {
    if (bodyMediaType === 'application/pdf') {
      return respond(201, { ok: savePdf(body) })
    }
    return respond(201, { ok: saveForm(body) })
  },
})
```

Use a plain Nitro handler when you need streaming part-by-part multipart
processing rather than a parsed contract value.

## Redirects

Redirect semantics belong to HTTP rather than a JSON response schema:

```ts
export default defineRouteHandler({
  validate: {
    query: z.object({ to: z.string().startsWith('/') }),
  },
  handler: ({ query }) =>
    new Response(null, {
      status: 302,
      headers: { location: query.to },
    }),
})
```

Call redirects with `.raw()` when status and `Location` matter.

## Proxies

Return the upstream `Response` directly. Do not declare a schema unless the
route actually reads and validates the upstream body:

```ts
export default defineRouteHandler({
  params: z.object({ path: z.string() }),
  handler: ({ request, params }) => {
    return fetch(new URL(params.path, 'https://upstream.example'), {
      method: request.method,
      headers: request.headers,
      signal: request.signal,
    })
  },
})
```

## Empty responses

An explicit 204 can be declared as a media response and returned with
`respond`:

```ts
export default defineRouteHandler({
  validate: {
    response: {
      204: { media: 'application/octet-stream', description: 'Deleted' },
    },
  },
  handler: ({ respond }) => respond(204, new Uint8Array()),
})
```

For strict HTTP semantics where no content type or body should be emitted,
return `new Response(null, { status: 204 })` without a response schema and
use `.raw()` on the client.

## When to keep a plain Nitro route

Use `defineEventHandler` directly when the contract would be incomplete or
misleading—for example, transparent proxies, open-ended streaming protocols,
or routes whose behavior is entirely controlled by another framework. Plain
and contracted routes coexist in the same server directory.
