---
title: Define Endpoints
description: Write request and response schemas next to the handler.
---

The endpoint definition is the contract for runtime validation, handler context types, generated client input, and OpenAPI schema output.

## Basic route

Default-export a `defineEndpoint()` call with a `handler` property. The handler receives parsed schema output.

```ts
import { z } from 'zod'

const User = z.object({
  id: z.number(),
  name: z.string(),
})

export default defineEndpoint({
  summary: 'Get a user',
  params: z.object({
    id: z.coerce.number(),
  }),
  query: z.object({
    includePosts: z.coerce.boolean().optional(),
  }),
  responses: { 200: User },
  handler: (event) => {
    const { params, query } = event.validated
    return {
      id: params.id,
      name: query.includePosts ? 'Tom with posts' : 'Tom',
    }
  },
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
export default defineEndpoint({
  params: UserParams,
  responses: { 200: User },
  handler: (event) => findUser(event.validated.params.id),
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
    params: z.object({ id: z.coerce.number() }),
    responses: { 200: User },
  }),
  put: defineEndpoint({
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
export default defineEndpoint({
  body: {
    'application/json': z.object({ name: z.string() }),
    'multipart/form-data': z.object({
      name: z.string(),
      avatar: z.instanceof(File),
    }),
  },
  responses: { 201: User },
  handler: (event) => {
    const { body } = event.validated
    const { bodyMediaType } = event
    // body is the union of member outputs; bodyMediaType narrows which one matched
    if (bodyMediaType === 'multipart/form-data') {
      // body.avatar is a File here
    }
    return event.respond(201, createUser(body.name))
  },
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

A schema needs one of those families, because a schema can only check a value
the runtime knows how to parse. For anything else — XML, a PDF, arbitrary bytes
— declare the member `true` instead and receive the body unparsed, as a
`Uint8Array`:

```ts
body: {
  'application/json': z.object({ name: z.string() }),
  'application/pdf': true,
}
```

This is the request-side counterpart of declaring a
[response by media type](#non-json-responses): the media type is part of the
contract and reaches OpenAPI, and the payload is yours. `true` accepts any
well-formed `type/subtype`, and nothing about the body is validated. It is read
into memory rather than streamed — for a genuinely large upload, drop the
contract and read the event directly, as [Low-level HTTP](/docs/low-level-http)
describes.

An empty map, uppercase keys, a malformed media type, or a schema on a family
the runtime cannot parse all fail at `defineEndpoint()` time — which means
during build discovery, not on a live request. A media-type map makes the body
mandatory: requests without a matching `Content-Type` are rejected with `415`
before the handler runs.

On the client, the generated `$endpoint` gains a `mediaType` request option for
map contracts. When the map has an `application/json` member, `mediaType` is
optional and calls read exactly like a single-schema body. Selecting any other
member types `body` as its wire value — `FormData` for multipart,
`URLSearchParams` for URL-encoded forms, `string` for `text/*`, and bytes for an
unparsed member — because the client does not invent an object-to-wire
serialization it cannot make honest:

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
export default defineEndpoint({
  params: z.object({ id: z.coerce.number() }),
  handler: (event) => {
    const requestId = event.req.headers.get('x-request-id')
    return findUser(event.context.user.accountId, event.validated.params.id, requestId)
  },
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

export default defineEndpoint({
  params: z.object({
    id: z.coerce.number(),
  }),
  responses: {
    200: User,
    404: ErrorBody,
  },
  handler: (event) => {
    const { params } = event.validated
    if (params.id === 404) {
      return event.respond(404, { message: 'Not found' })
    }

    return { id: params.id, name: 'Tom' }
  },
})
```

## Non-JSON responses

A validated response body is always sent as JSON — that is what having a schema for it means. Everything else goes through one door: declare the status by its media type instead of by a schema.

```ts
export default defineEndpoint({
  query: z.object({ delimiter: z.string().optional() }),
  responses: {
    200: { media: 'text/csv', description: 'CSV export' },
    404: ErrorBody,
  },
  handler: (event) => {
    return event.respond(200, toCsvStream(event.validated.query.delimiter ?? ','))
  },
})
```

The same door covers every case that is not JSON — XML, CSV, a file download, an event stream, arbitrary bytes:

```ts
responses: {
  200: { media: 'application/xml' },
  200: { media: 'application/pdf' },
  200: { media: 'text/event-stream' },
  200: { media: 'application/octet-stream' },
}
```

The handler may return anything the HTTP layer forwards to the socket as-is: a web `ReadableStream`, a Node readable, a native `Response`, a `Blob`, raw bytes, or an already-encoded string. The declared media type is sent for you unless the handler sets one itself.

Nothing about the payload is validated, and that is the whole distinction from `body`. There is no schema to check it against, and a stream cannot be buffered and checked without defeating the reason it is a stream. The media type is required rather than defaulted, because taking this door means knowing what you are sending. An optional `schema` documents the payload — or one chunk of it — in the [generated OpenAPI document](/docs/openapi), and is named `schema` rather than `body` precisely because it never checks anything:

```ts
responses: {
  200: {
    media: 'application/x-ndjson',
    schema: z.object({ id: z.string(), at: z.string() }),
  },
}
```

With several declared media types, key the schema by media type — one schema cannot honestly describe a CSV and a JSON object at once, so a bare schema alongside several types fails the build rather than being copied onto each. Types the map omits stay described as opaque bytes:

```ts
responses: {
  200: {
    media: ['text/csv', 'application/json'],
    schema: { 'application/json': z.object({ id: z.string(), name: z.string() }) },
  },
}
```

### Several representations of one status

Give `media` an array and the status has more than one representation. The runtime negotiates from the request's `Accept` header, tells the handler which one to produce, and sends that media type:

```ts
export default defineEndpoint({
  responses: {
    200: { media: ['text/csv', 'application/json'], description: 'User export' },
    404: ErrorBody,
  },
  handler: (event) => {
    // narrowed to 'text/csv' | 'application/json'
    return event.respond(
      200,
      event.responseMediaType === 'text/csv' ? toCsv(rows) : JSON.stringify(rows),
    )
  },
})
```

This is the mirror image of a [media-type request body](#media-type-request-bodies): that one reads `Content-Type` and answers 415, this one reads `Accept` and answers 406.

Only _successful_ statuses take part. A media-typed error — a `problem+json` 404, an HTML error page — is not an alternative the caller chooses between; it is what happens instead. So adding one to an endpoint never starts refusing clients, and a request cannot negotiate its way into an error's media type.

Declaration order is the endpoint's own preference. It breaks ties between equally acceptable types, and it answers a request that expresses no preference at all — an absent header, or `*/*`. That is what makes omitting `accept` on the client a sensible default rather than an arbitrary one.

Each media type must be a single lowercase `type/subtype`, and the build fails otherwise — `media: 'text/csv, application/json'` and `media: ['csv', 'json']` are rejected rather than becoming a nonsense `Content-Type` or an endpoint that answers 406 to everything.

Selection follows RFC 9110: quality weights are honored, a more specific range overrides a wider one that would otherwise apply, and `q=0` is a refusal rather than a weak preference. When nothing the endpoint can produce is acceptable, the request is refused with `406 Not Acceptable` **before anything else is validated and before the body is read** — `Accept` does not depend on the rest of the request, and a request that can never be answered is not worth reading an upload for. That refusal goes through [`onValidationError`](#hooks) like any other, with `kind: 'accept'`.

Every response of a negotiating endpoint carries `Vary: Accept` — including the 406, and including statuses that are not media responses. The header describes the route, not one answer: a cache that only ever saw the CSV must still know the JSON exists. A handler that declares its own `Vary` adds to it rather than replacing it, because `Vary` is a list of what the answer depended on and dropping an entry hands caches a wrong answer.

On the client, `accept` asks for one of the declared types and is typed to them:

```ts
const result = await $endpoint('exportUsers', { accept: 'application/json' })
```

It is optional — omitting it takes the endpoint's preference — and it is part of the TanStack Query cache key, so two calls that differ only in `accept` are two cached values.

An endpoint that negotiates and also uses [`Idempotency-Key`](/docs/idempotency) counts the negotiated media type as part of request identity: a retry that reuses the key but asks for a different representation is answered with `422`, not with the representation it did not ask for. Producing the other one would mean re-running a handler whose side effect already happened, which is what the key exists to prevent — use a separate key.

`responseMediaType` is present whenever the endpoint declares any media type, not only when it negotiates: with a single declared type it is that type. The field always means the same thing — what this response is being sent as.

### JSON with a different media type

`application/problem+json` and other `+json` profiles are still JSON, so they keep their schema and stay validated. Label them with `contentType` on the validated form, and the header is sent:

```ts
responses: {
  404: {
    body: z.object({ type: z.string(), title: z.string(), status: z.number() }),
    contentType: 'application/problem+json',
  },
}
```

`contentType` accepts JSON media types only. A non-JSON value there would describe one thing and send another, so the build fails and names `media` as the replacement:

```
Response 200 declares contentType 'application/xml' on a validated body,
which is always sent as JSON. Declare media: 'application/xml' instead —
it sends what the handler returns and documents that media type.
```

### On the client

A route with any media response is unparsed end to end: the generated client tells the fetcher not to read the body, so what you get back is the live stream rather than a decoded copy of it once it has all arrived.

```ts
const result = await $endpoint('exportUsers', { query: { delimiter: ';' } })
const reader = result.body.getReader()

// or, when you need the status and headers too
const response = await $endpoint('exportUsers', { query: {} }).raw()
```

Two consequences follow from the client never parsing the response:

- Every status of that route arrives as a stream, including a validated `404` the contract still declares. Those declarations remain true for the server and for OpenAPI; the client just hands you the bytes.
- `useEndpoint` and the Vue Query factories are the wrong tools for such a route — an unread stream cannot be cached or serialized into the Nuxt payload. The build warns when one would get a query option factory.

Pass an explicit `responseType` when you want the fetcher to decode after all, which is the usual choice for a file download:

```ts
const result = await $endpoint('downloadInvoice', { responseType: 'blob' })
const blob = result.body
```

## Response validation

Declared response schemas are validated automatically before the handler value is serialized.

```ts
export const endpoint = defineEndpoint({
  responses: { 200: User },
})
```

## Routes registered by configuration

Discovery does not depend on file scanning. It reads Nitro's configured handlers alongside its scanned ones, so a route registered through `nitro.handlers` — or by another Nuxt module calling `addServerHandler` — is an ordinary endpoint: validated, in the generated client, typed identically, and in the OpenAPI document.

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  nitro: {
    handlers: [
      {
        route: '/custom/report',
        method: 'get',
        handler: resolve('server/custom-routes/report.get.ts'),
      },
    ],
  },
})
```

```ts
// server/custom-routes/report.get.ts — outside every scanned directory
export default defineEndpoint({
  query: z.object({ id: z.string() }),
  responses: {
    200: z.object({ id: z.string(), source: z.literal('custom-route') }),
  },
  handler: (event) => {
    return event.respond(200, { id: event.validated.query.id, source: 'custom-route' })
  },
})
```

```ts
const report = await $endpoint('getCustomReport', { query: { id: 'r_1' } })
```

One requirement: the handler entry's `handler` must be a path to a real source file with a JS or TS extension. That is what discovery evaluates to read the contract, so a handler given as an inline function, or as a virtual module specifier, is skipped rather than guessed at — it still serves requests, it is just not an endpoint.

The route template is yours to choose and does not have to sit under `/api`. It is still subject to the [route template limits](/docs/limits): no catch-all and no optional parameter, because the generated client could not build those URLs.

## Separate contract files

Reach for two calls — `defineEndpoint()` without a `handler`, paired with `defineEndpointHandler()` — when the handler needs to live somewhere other than inline in the contract: in its own file, as this section covers, or shared by several routes that each attach it to their own contract. Omitting `handler` returns a contract, and `defineEndpointHandler()` attaches a handler to it.

Endpoint metadata is collected during Nuxt type generation by evaluating the module that defines the contract. With a co-located contract, that module is the route file itself — so its top-level code runs at build time too. Routes whose top-level code is heavy (opens connections, reads required environment) can move the contract to a sibling `.endpoint-contract` file instead, keeping it right next to the handler:

```ts
// server/api/users/[id].get.endpoint-contract.ts — evaluated during type generation; keep it side-effect free
import { defineEndpoint } from 'nuxt-endpoints/runtime'
import { z } from 'zod'

export const getUserEndpoint = defineEndpoint({
  params: z.object({ id: z.coerce.number() }),
  responses: { 200: z.object({ id: z.number(), name: z.string() }) },
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
