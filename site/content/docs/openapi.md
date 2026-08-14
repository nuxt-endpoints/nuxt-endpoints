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

Use OpenAPI options for document-level metadata, servers, components, security schemes, and last-mile extension.

```ts
createOpenApiDocument(routes, {
  title: 'Example API',
  version: '1.0.0',
  document: {
    servers: [{ url: 'https://api.example.com' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
        },
      },
    },
  },
  extend(document) {
    document.security = [{ bearerAuth: [] }]
  },
})
```

## Generated from route contracts

Request schemas, response schemas, summaries, route paths, and optional operation IDs are collected from discovered endpoint definitions. When `operation` is omitted, a stable operationId is derived from the route method and path. OpenAPI-only details can still be layered in through `document` and `extend`.
