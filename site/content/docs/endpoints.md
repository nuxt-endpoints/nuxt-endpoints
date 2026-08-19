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

Send `multipart/form-data` from the client. Its `Content-Type` carries a
boundary generated while the request is built, and a server-side call to a
local route never builds one — Nuxt dispatches straight into the handler — so
such a call arrives without a `Content-Type` and is rejected with `415`. Every
other media type is labelled by the client itself and works from either side.

Two caveats:

- The generated OpenAPI document lists every member under `requestBody.content`.
  Schema constructs the converter libraries cannot express (such as
  `z.instanceof(File)`) fail conversion according to those libraries' behavior.
- The default idempotency fingerprint projects `body`, and `File` values are
  not JSON-serializable, so an idempotent multipart endpoint must supply a
  custom `fingerprint` that projects serializable fields only.

## Hooks

Two extension points sit on every endpoint, and both are declared the same way
at either scope: as runtime options on `defineEndpoint()`, or application-wide
in `server/endpoints/runtime.ts`.

```ts
// server/endpoints/runtime.ts
export default defineEndpointRuntime({
  onValidationError: ({ kind, source, event }) => ({
    status: 422,
    body: { error: 'invalid_request', field: source, reason: kind },
  }),
  wrapHandler: async (context, next) => {
    const started = Date.now()
    try {
      return await next()
    } finally {
      recordDuration(context.event, Date.now() - started)
    }
  },
})
```

```ts
// or on one endpoint, using the same key names
export const endpoint = defineEndpoint(
  { query: z.object({ page: z.coerce.number() }) },
  {
    onValidationError: (failure) =>
      failure.kind === 'media-type'
        ? { status: 400, body: { accepts: failure.supportedMediaTypes } }
        : undefined,
  },
)
```

### onValidationError

Shapes the response for a request that does not match its contract, replacing
the default `400` for a schema failure and `415` when no media-type member
matches. The failure describes what its kind can:

- `kind: 'schema'` — `source` is `params`, `query`, `headers`, or `body`, and
  `issues` holds the validator's issues.
- `kind: 'media-type'` — `source` is always `body`, with the normalized
  `received` Content-Type (`null` when the request sent none) and the
  `supportedMediaTypes` the contract declares.

Both carry `event`, so an envelope can include values Nitro middleware
attached. Return `status`, `body`, and optionally `statusText` and `headers` —
or return nothing to decline, which passes the failure to the next scope.
Resolution runs endpoint → application → default.

Handler exceptions are ordinary Nitro errors and stay outside this hook, as do
idempotency failures, which keep their `application/problem+json` Problem
Details shape.

### wrapHandler

Wraps handler execution, after validation. Call `next()` to run the handler,
or return a response without calling it to answer on its behalf — that is how
a recorded idempotent response is replayed. Because a wrapper is an ordinary
function, `try`/`finally` is how work that must survive a thrown handler is
expressed, and its own scope is how state is carried across the call.

Wrappers nest outermost-first: the application wrapper, then the endpoint's
own, then that endpoint's idempotency handling closest to the handler. A
replayed response therefore still unwinds back out through both wrappers,
which is what makes rate limiting or audit logging count replays too.

The context is the same one the handler receives, so `context.event`,
validated `params`, `query`, `headers`, and `body` are all available.

`server/endpoints/runtime.ts` holds every application-wide endpoint setting
that `nuxt.config.ts` cannot: module options reach the server as JSON, so they
cannot carry functions or the connections those functions close over. Two more
settings live in the same file under their own keys — the
[central idempotency policy](/docs/idempotency#central-policy) and
[OpenAPI document metadata](/docs/openapi#document-metadata).

To use a different path, set
`endpoints: { runtime: { path: 'server/policies/endpoints.ts' } }`.

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

## Streaming responses

A route that streams its response can still be a declared endpoint. Mark the status `stream: true` and give it the media type it sends:

```ts
export const endpoint = defineEndpoint({
  operation: 'exportUsers',
  query: z.object({ delimiter: z.string().optional() }),
  responses: {
    200: { stream: true, contentType: 'text/csv', description: 'CSV export' },
    404: ErrorBody,
  },
})

export default defineEndpointHandler(endpoint, ({ query, respond }) => {
  return respond(200, toCsvStream(query.delimiter ?? ','))
})
```

The handler may return anything the HTTP layer forwards to the socket as-is: a web `ReadableStream`, a Node readable, a native `Response`, a `Blob`, raw bytes, or an already-encoded string. The declared `contentType` is applied for you unless the handler sets one itself; it defaults to `application/octet-stream`.

Nothing about the payload is validated. A stream cannot be buffered and checked without defeating the reason it is a stream, so `stream: true` is a declaration, not a contract on the bytes. That is also why the media type is declared rather than inferred, and why the payload's optional `schema` is named `schema` and not `body` — it documents the stream in the [generated OpenAPI document](/docs/openapi) and is never used to check anything:

```ts
responses: {
  200: {
    stream: true,
    contentType: 'application/x-ndjson',
    schema: z.object({ id: z.string(), at: z.string() }),
  },
}
```

On the client, a route with a stream response is a streaming route end to end: the generated client tells the fetcher not to parse the body, so what you get back is the live stream rather than a decoded copy of it once it has all arrived.

```ts
const stream = await $endpoint('exportUsers', { query: { delimiter: ';' } })
const reader = stream.getReader()

// or, when you need the status and headers too
const response = await $endpoint('exportUsers', { query: {} }).raw()
```

Two consequences follow from the client never parsing the response:

- Every status of that route arrives as a stream, including a validated `404` the contract still declares. Those declarations remain true for the server and for OpenAPI; the client just hands you the bytes.
- `useEndpoint` and the Vue Query factories are the wrong tools for a streaming route — a stream cannot be cached or serialized into the Nuxt payload. The build warns when a stream route would get a query option factory.

Pass an explicit `responseType` when you want the fetcher to decode after all, which is the usual choice for a file download:

```ts
const blob = await $endpoint('downloadInvoice', { responseType: 'blob' })
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
