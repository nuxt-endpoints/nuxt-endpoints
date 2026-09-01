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
  handler: (event) => new Response(`raw response for ${event.validated.params.id}`),
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
  params: z.object({ id: z.string() }),
  validate: {
    response: {
      200: { media: 'application/pdf', description: 'Invoice PDF' },
    },
  },
  handler: async (event) => {
    const file = await loadFile(event.validated.params.id)
    return event.respond(200, file.bytes, {
      headers: { 'content-disposition': `attachment; filename="${file.name}"` },
    })
  },
})
```

```ts
const response = await $endpoint('/api/invoices/:id/download', {
  method: 'get',
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
  handler: (event) => {
    if (event.bodyMediaType === 'application/pdf') {
      return event.respond(201, { ok: savePdf(event.validated.body) })
    }
    return event.respond(201, { ok: saveForm(event.validated.body) })
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
  handler: (event) =>
    new Response(null, {
      status: 302,
      headers: { location: event.validated.query.to },
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
  handler: (event) => {
    return fetch(new URL(event.validated.params.path, 'https://upstream.example'), {
      method: event.req.method,
      headers: event.req.headers,
      signal: event.req.signal,
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
  handler: (event) => event.respond(204, new Uint8Array()),
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
