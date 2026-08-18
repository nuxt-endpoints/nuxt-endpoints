---
title: Define Endpoints
description: Write request and response schemas next to the handler.
---

The endpoint definition is the contract for runtime validation, handler context types, generated client input, and OpenAPI schema output.

## Basic route

Export an endpoint definition and default-export a handler created with `defineEndpointHandler`. The handler receives parsed schema output.

```ts
import { z } from 'zod'

const User = z.object({
  id: z.number(),
  name: z.string(),
})

export const endpoint = defineEndpoint({
  summary: 'Get a user',
  params: z.object({
    id: z.coerce.number(),
  }),
  query: z.object({
    includePosts: z.coerce.boolean().optional(),
  }),
  response: User,
})

export default defineEndpointHandler(endpoint, ({ params, query }) => {
  return {
    id: params.id,
    name: query.includePosts ? 'Tom with posts' : 'Tom',
  }
})
```

The generated client can call this route by path and method:

```ts
await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
  query: { includePosts: true },
})
```

Add `operation` when you also want a named call target or a hand-picked OpenAPI operationId:

```ts
export const endpoint = defineEndpoint({
  operation: 'getUser',
  params: UserParams,
  response: User,
})

await $endpoint('getUser', { params: { id: '123' } })
await $endpoint.getUser({ params: { id: '123' } })
```

## Validated request parts

- `params`: route params are parsed before the handler runs. Coercion is reflected in handler types.
- `query`: query string values can be coerced into booleans, numbers, arrays, or richer schemas.
- `headers`: header schemas are useful for explicit authentication or versioning boundaries.
- `body`: JSON request bodies are the first-class body format in the current API.

## Request event and middleware context

The handler context exposes both the original H3 `event` and a normalized Web `request`:

- Use `event` for Nitro middleware context and other runtime-specific features.
- Use `request` for portable access to the URL, method, headers, and abort signal.

This does not change the endpoint handler into a Web-standard `(Request) => Response` handler. It still receives the typed endpoint context and may return a plain value.

Use standard Nitro middleware to attach request-scoped values such as the current user, tenant, request ID, or tracing context to `event.context`.

```ts
// server/middleware/auth.ts
export default defineEventHandler(async (event) => {
  event.context.user = await requireUserSession(event)
})
```

The same event and its middleware context are available alongside the Web request in an endpoint handler:

```ts
export default defineEndpointHandler(endpoint, ({ event, request, params }) => {
  const requestId = request.headers.get('x-request-id')
  return findUser(event.context.user.accountId, params.id, requestId)
})
```

For endpoints with a body contract, use the parsed and validated `body` value from the endpoint context. Do not assume that the raw `request` body can be consumed again after endpoint parsing.

Use H3 module augmentation when the application needs shared static types for custom context fields:

```ts
declare module 'h3' {
  interface H3EventContext {
    user: {
      id: string
      accountId: string
    }
  }
}
```

## Multiple responses

Use `responses` when an endpoint can return multiple statuses. Return a specific status with `respond`, and TypeScript checks that the body matches the declared schema.

```ts
const ErrorBody = z.object({
  message: z.string(),
})

export const endpoint = defineEndpoint({
  params: z.object({
    id: z.coerce.number(),
  }),
  responses: {
    200: User,
    404: ErrorBody,
  },
})

export default defineEndpointHandler(endpoint, ({ params, respond }) => {
  if (params.id === 404) {
    return respond(404, { message: 'Not found' })
  }

  return { id: params.id, name: 'Tom' }
})
```

## Response validation

Response validation is opt-in so production handlers can decide how strict their output boundary should be.

```ts
export const endpoint = defineEndpoint(
  {
    response: User,
  },
  {
    validation: {
      response: true,
    },
  },
)
```

## Separate contract files

Endpoint metadata is collected during Nuxt type generation by evaluating the module that defines the contract. With a co-located contract, that module is the route file itself — so its top-level code runs at build time too. Routes whose top-level code is heavy (opens connections, reads required environment) can move the contract to a sibling `.endpoint-contract` file instead, keeping it right next to the handler:

```ts
// server/api/users/[id].get.endpoint-contract.ts — evaluated during type generation; keep it side-effect free
import { defineEndpoint } from 'nuxt-endpoints/runtime'
import { z } from 'zod'

export const getUserEndpoint = defineEndpoint({
  operation: 'getUser',
  params: z.object({ id: z.coerce.number() }),
  response: z.object({ id: z.number(), name: z.string() }),
})
```

```ts
// server/api/users/[id].get.ts — never evaluated at build time
import { getUserEndpoint } from './[id].get.endpoint-contract'

const db = await connectToDatabase() // top-level code is now safe

export default defineEndpointHandler(getUserEndpoint, ({ params }) => {
  return db.users.find(params.id)
})
```

The module registers `**/*.endpoint-contract.*` in Nitro's `ignore` option, so these files never become Nitro routes even though they live inside `server/api`. (The same pattern also excludes matching filenames from Nitro's public-asset copying — avoid naming files under `public/` this way.)

When the value passed to `defineEndpointHandler` is a statically imported identifier, discovery evaluates only the contract module and never imports the route file. Rules:

- Import `defineEndpoint` explicitly from `nuxt-endpoints/runtime` in separate contract modules. Discovery can evaluate an auto-imported helper, but the ignored sibling file does not receive that helper's generated TypeScript declaration during standalone type-checking.
- The import must be a plain static `import` of the identifier (named, aliased, or default). Namespace access (`contracts.getUser`), locally computed values, and auto-imports fall back to evaluating the route module.
- The contract module's own import graph is evaluated with it, so keep it to schema definitions. Watch out for barrel files that re-export server runtime code.
- Contracts can also live at any importable path outside `server/api` and `server/routes` if you prefer collecting them elsewhere — the `.endpoint-contract` suffix is only required inside route directories, where every ordinary file becomes a route. Note the ownership split: contracts are your application's code wherever they live, while `server/endpoints/` is where this module looks for its own convention files, such as the [central idempotency policy](/docs/idempotency#central-policy).

Routes that define no endpoint at all are never evaluated during discovery, so this only matters for endpoint routes with heavy top-level code.
