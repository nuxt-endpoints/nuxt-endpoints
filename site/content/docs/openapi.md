---
title: OpenAPI
description: Serve OpenAPI 3.1 from endpoint definitions.
---

The generated document is based on the same request and response schemas used by the runtime.

## Schema route

By default, the module serves an OpenAPI document at `/_endpoints/schema`, but only in development. Set `endpoints.openApi` to `false` to disable the generated route entirely, or explicitly set `endpoints.openApi` to `true` (or `endpoints.openApi.enabled` to `true`) to also serve it in production.

```http
GET /_endpoints/schema
```

## Document metadata

`title`, `version`, and the schema route itself are plain values, so they are module options:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  endpoints: {
    openApi: { title: 'Example API', version: '1.0.0' },
  },
})
```

Everything else about the document belongs to the application rather than to any endpoint — where the API is deployed, how it is authenticated, how operations are grouped. None of that can come from `nuxt.config.ts`, because module options reach the server as JSON and an extension callback is a function. It is declared in [`server/endpoints/runtime.ts`](/docs/endpoints#hooks), alongside the other application-wide endpoint settings:

```ts
// server/endpoints/runtime.ts
export default defineEndpointRuntime({
  openApi: {
    document: {
      servers: [{ url: 'https://api.example.com' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
      tags: [{ name: 'users', description: 'User management' }],
    },
    extend(document) {
      document.security = [{ bearerAuth: [] }]
    },
  },
})
```

- `document` is deep-merged into the generated document, so it adds to what the contracts produced instead of replacing it. Use it for declarative additions.
- `extend` runs last, on the merged document, and mutates it in place. Use it when a patch cannot express the edit — reading the generated `operationId`s, or attaching `security` to specific paths.

Both are optional. With neither, the document is exactly what the route contracts describe.

## Generated from route contracts

Request schemas, response schemas, summaries, route paths, and optional operation IDs are collected from discovered endpoint definitions. When `operation` is omitted, a stable operationId is derived from the route method and path. OpenAPI-only details are layered on top through `document` and `extend` above.

A [streaming response](/docs/endpoints#streaming-responses) appears like any other status. Its media type is the declared `contentType`, defaulting to `application/octet-stream`, and its schema is the opaque `{ type: 'string', contentEncoding: 'binary' }` unless the declaration supplies a `schema` to document the payload — or one chunk of it — in more detail.
