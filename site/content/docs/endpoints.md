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

## Multiple methods on one route

A route file without a method suffix can declare several methods at once. Each
member is an ordinary `defineEndpoint()` contract, so operations, response
statuses, media-type bodies, and idempotency all work per method:

```ts
// server/api/users/[id].ts — no method suffix
export const endpoints = defineEndpointMethods({
  get: defineEndpoint({
    operation: 'getUser',
    params: z.object({ id: z.coerce.number() }),
    response: User,
  }),
  put: defineEndpoint({
    operation: 'updateUser',
    params: z.object({ id: z.coerce.number() }),
    body: UpdateUser,
    responses: { 200: User, 404: NotFound },
  }),
})

export default defineEndpointMethodHandlers(endpoints, {
  get: ({ params }) => findUser(params.id),
  put: ({ params, body, respond }) => respond(200, updateUser(params.id, body)),
})
```

The generated client calls each method on the one path, and every member keeps
its own request and response types:

```ts
await $endpoint('/api/users/:id', { method: 'get', params: { id: '1' } })
await $endpoint('updateUser', { params: { id: '1' }, body: { name: 'Tom' } })
```

The dispatcher answers the whole route:

- Declared methods run their own handler, with their own validation.
- `HEAD` runs the `GET` member and returns its status and headers with no body.
- `OPTIONS` answers `204` with an `Allow` header.
- Anything else gets `405` with the same `Allow` header, listing the declared
  methods plus the derived `HEAD` and `OPTIONS`.

Declaring `head` or `options` yourself is an error — they are derived — and so
are empty groups, `connect`/`trace`, and handler maps whose keys do not match
the group. Groups belong on method-suffix-free files: putting one in
`users.get.ts` fails the build, because the other methods would be
unreachable. The reverse also fails: a single `defineEndpoint()` in a
suffix-free file cannot know which method it serves.

Use single-method files when a route has one method — nothing about them
changes. Reach for a group when one path genuinely serves several methods and
you would rather keep them together.

## Media-type request bodies

A `body` contract can also be a map from media types to schemas. The request's
`Content-Type` (parameters such as `charset` stripped, lowercased) selects the
member to validate against; a request matching no member gets a `415` listing
the supported types.

```ts
export const endpoint = defineEndpoint({
  operation: 'createUser',
  body: {
    'application/json': z.object({ name: z.string() }),
    'multipart/form-data': z.object({
      name: z.string(),
      avatar: z.instanceof(File),
    }),
  },
  responses: { 201: User },
})

export default defineEndpointHandler(endpoint, ({ body, bodyMediaType, respond }) => {
  // body is the union of member outputs; bodyMediaType narrows which one matched
  if (bodyMediaType === 'multipart/form-data') {
    // body.avatar is a File here
  }
  return respond(201, createUser(body.name))
})
```

Supported member families and how each is parsed before validation:

- `application/json` — parsed as JSON, exactly like a single-schema body.
- `application/x-www-form-urlencoded` — parsed into an object.
- `multipart/form-data` — parsed into an object: repeated field names become
  arrays, file parts stay `File` values (validate them with e.g.
  `z.instanceof(File)`).
- `text/plain` and other specific `text/*` types — the raw request text as a
  string, with no coercion.

Any other media type, an empty map, or uppercase keys fail at
`defineEndpoint()` time — which means during build discovery, not on a live
request. A media-type map makes the body mandatory: requests without a
matching `Content-Type` are rejected with `415` before the handler runs.

On the client, the generated `$endpoint` gains a `mediaType` request option for
map contracts. When the map has an `application/json` member, `mediaType` is
optional and calls read exactly like a single-schema body. Selecting any other
member types `body` as its wire value — `FormData` for multipart,
`URLSearchParams` for URL-encoded forms, `string` for `text/*` — because the
client does not invent an object-to-wire serialization it cannot make honest:

```ts
const formData = new FormData()
formData.append('name', 'Tom')
formData.append('avatar', file)

await $endpoint('createUser', {
  mediaType: 'multipart/form-data',
  body: formData, // typed as FormData; content-type is left to the runtime
})
```

Maps without a JSON member make `mediaType` required at the type level. The
option also participates in `useEndpoint` and Vue Query cache keys, so calls
differing only by media type never share a cache entry.

Two caveats:

- The generated OpenAPI document lists every member under `requestBody.content`.
  Schema constructs the converter libraries cannot express (such as
  `z.instanceof(File)`) fail conversion according to those libraries' behavior.
- The default idempotency fingerprint projects `body`, and `File` values are
  not JSON-serializable, so an idempotent multipart endpoint must supply a
  custom `fingerprint` that projects serializable fields only.

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
