---
title: Incremental Adoption
description: Convert one route at a time. Every other route keeps working unchanged.
---

Nuxt Endpoints is opt-in per route. A server route joins the endpoint system only when it directly default-exports `defineRouteHandler({...})`. Everything else in `server/` keeps running as a plain Nitro route, untouched by this module.

## How discovery works

During build, the module inspects each scanned server route:

- If the route uses the canonical `defineRouteHandler` form, it joins the generated client, the `#endpoints` types, and the OpenAPI document. Schemas and metadata may be imported from ordinary modules.
- If it does not, the route is skipped entirely — it is not even imported during discovery. No validation is added, no types are generated for it, and its runtime behavior does not change.

There is no global middleware and no route allowlist to maintain. The export itself is the opt-in switch.

## Convert a single route

Start from an ordinary Nitro route:

```ts
// server/api/users/[id].get.ts
export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  return { id, name: 'Tom' }
})
```

Add the contract and handler in one call, replacing the plain event handler:

```ts
// server/api/users/[id].get.ts
import { z } from 'zod'

export default defineRouteHandler({
  params: z.object({
    id: z.coerce.number(),
  }),
  validate: {
    response: {
      200: z.object({
        id: z.number(),
        name: z.string(),
      }),
    },
  },
  handler: (event) => {
    return { id: event.validated.params.id, name: 'Tom' }
  },
})
```

The route path, method, and callers do not change. Existing `$fetch('/api/users/1')` calls keep working; the route now also validates its request and appears on `$endpoint` and in the OpenAPI document.

## Roll back a route

Replace `defineRouteHandler` with `defineEventHandler`. The route leaves the generated client and OpenAPI document, and nothing else needs to be updated.

## Coexistence rules

- Plain routes and endpoint routes live side by side in the same `server/api` directory.
- `$endpoint` and `#endpoints` types cover only converted routes, so autocomplete reflects exactly what has a contract.
- The OpenAPI document lists only converted routes. It grows as the migration proceeds.
- Plain routes are still called with `$fetch` as before. There is no requirement to finish the migration.

## Suggested migration order

1. Start with routes whose input validation you already hand-wrote — the contract usually replaces existing `getQuery`/`readBody` checks directly.
2. Convert routes consumed by typed client code next, where `$endpoint` and `useEndpoint` remove manual type assertions.
3. Convert externally consumed routes when you want them in the OpenAPI document.
4. Leave file streams, redirects, and other low-level handlers as plain routes, or see [Low-level HTTP](/docs/low-level-http) for the escape hatches.
