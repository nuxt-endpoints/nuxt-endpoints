---
title: Define Endpoints
description: Declare validated request and response contracts with the canonical route-handler API.
---

Nuxt Endpoints uses a single-definition route shape designed to align with the
route-contract work happening in H3 and Nitro. Directly default-export
`defineRouteHandler({...})`; the handler receives parsed schema output.

```ts
// server/api/users/[id].get.ts
import { z } from 'zod'

export default defineRouteHandler({
  params: z.object({ id: z.coerce.number() }),
  validate: {
    query: z.object({ include: z.string().optional() }),
    response: {
      200: z.object({ id: z.number(), name: z.string() }),
      404: z.object({ message: z.string() }),
    },
  },
  handler: (event) => {
    const { params, query } = event.validated
    const user = findUser(params.id, query.include)
    return user ?? event.respond(404, { message: 'Not found' })
  },
})
```

On Nuxt 4/Nitro 2/H3 1, the module implements this API through a private
compatibility adapter. As compatible upstream primitives become available, that
adapter can shrink without changing the route or client UX.

## Definition fields

Root fields describe route-wide metadata and path params:

- `params`: Standard Schema for router params.
- `summary`, `description`, `tags`: OpenAPI metadata.
- `idempotency`: serializable idempotency contract metadata.
- `validate`: request and response schemas.
- `handler`: the single-method handler.

`validate` accepts:

- `query`: parsed query object.
- `headers`: request header object.
- `body`: one schema or a media-type map.
- `response`: one schema for status 200 or a status-to-response map.

Schema input types become generated client request types. Schema output types
become handler context types, so coercions and transforms have already run.

## Multiple methods in one route

A method-suffix-free route can declare several methods in the same canonical
call. Shared `params` live at the root; each method owns its metadata,
validation, and handler.

```ts
// server/api/users/[id].ts
import { z } from 'zod'

const User = z.object({ id: z.number(), name: z.string() })
const Params = z.object({ id: z.coerce.number() })

export default defineRouteHandler({
  params: Params,
  get: {
    validate: {
      response: { 200: User, 404: z.object({ message: z.string() }) },
    },
    handler: (event) => {
      return findUser(event.validated.params.id) ?? event.respond(404, { message: 'Not found' })
    },
  },
  put: {
    validate: {
      body: z.object({ name: z.string() }),
      response: { 200: User },
    },
    handler: (event) => updateUser(event.validated.params.id, event.validated.body),
  },
})
```

Use the single form in files such as `users.get.ts`; use the multi-method
form in a bare file such as `users.ts`. Mixing a multi-method definition with
a method-suffixed filename fails generation because the remaining methods
would be unreachable.

The declarable methods are `get`, `post`, `put`, `patch` and `delete`. `HEAD`
is answered by the `get` entry with the body dropped, and `OPTIONS` answers
`204` with an `Allow` header listing the declared methods, so neither is
declared directly. `CONNECT` and `TRACE` are not routed. The Nuxt 5 line
accepts all nine as explicit entries, so a route that declares one of them is
the single case that does not port back to this line unchanged.

## Handler event

The handler receives the native H3 event, extended with the endpoint contract:

- `event.validated.params`, `.query`, `.headers`, and `.body`: parsed schema outputs.
- `event.bodyMediaType`: selected request media type for a body map.
- `event.responseMediaType`: negotiated media response type.
- `event.respond(status, body, options?)`: typed status response.
- the usual H3 event context and request properties remain directly available.

```ts
export default defineRouteHandler({
  validate: {
    body: z.object({ name: z.string().trim() }),
    response: {
      201: z.object({ id: z.number(), name: z.string() }),
      409: z.object({ message: z.string() }),
    },
  },
  handler: async (event) => {
    const { body } = event.validated
    if (await nameExists(body.name)) {
      return event.respond(409, { message: 'Already exists' })
    }
    return event.respond(201, await createUser(body))
  },
})
```

Returning a plain body is the status-200 shorthand. Use `respond` whenever
the status matters. TypeScript rejects a status or body not declared by the
response contract.

## Response validation

Response schemas drive types, OpenAPI, and optional runtime response validation.
During development, a declared response is validated before it is serialized:

```ts
export default defineRouteHandler({
  validate: {
    response: { 200: z.object({ createdAt: z.date() }) },
  },
  handler: () => ({ createdAt: new Date() }),
})
```

The server value is validated as `Date`; generated HTTP clients see the JSON
wire value as `string`.

Production skips this extra traversal by default. Configure the application-wide
policy in `server/endpoints/runtime.ts` when response values cross an untyped or
independently deployed boundary:

```ts
export default defineEndpointRuntime({
  validation: {
    response: 'always', // 'development' (default) | 'always' | 'never'
  },
})
```

The setting controls body and declared-header schema checks only. Request
validation, status declaration checks, content negotiation, and idempotency stay
active. In particular, `never` still rejects a status absent from the route contract.

A status can also declare the headers it promises. When response validation is active, declared
headers are checked against what is actually sent, so a missing or rejected header fails with a
`500` response contract error. Header names are matched case-insensitively; use an optional schema
when a header is not always present.

```ts
export default defineRouteHandler({
  validate: {
    response: {
      200: {
        body: z.object({ id: z.number() }),
        headers: { 'X-Request-Id': z.string().uuid() },
      },
    },
  },
  handler: (event) =>
    event.respond(200, { id: 1 }, { headers: { 'x-request-id': crypto.randomUUID() } }),
})
```

Declared response headers also appear in the generated OpenAPI document.

## Request media types

Use a media-type map when one route accepts more than one representation.
Schema members are parsed; `true` members expose raw bytes.

```ts
export default defineRouteHandler({
  validate: {
    body: {
      'application/json': z.object({ name: z.string() }),
      'multipart/form-data': z.object({ name: z.string() }),
      'application/pdf': true,
    },
    response: { 201: z.object({ ok: z.literal(true) }) },
  },
  handler: (event) => {
    return event.respond(201, { ok: true })
  },
})
```

The client request becomes a discriminated union keyed by `mediaType`.
Unsupported content types are rejected with 415 before the handler runs.

## Media responses

A response entry with `media` declares an unparsed representation such as a
file or stream:

```ts
export default defineRouteHandler({
  validate: {
    response: {
      200: { media: ['text/csv', 'application/json'] },
      404: z.object({ message: z.string() }),
    },
  },
  handler: (event) => {
    const body =
      event.responseMediaType === 'application/json' ? JSON.stringify(rows) : createCsvStream(rows)
    return event.respond(200, body)
  },
})
```

Use `.raw()` for routes whose live stream or headers matter. See
[Low-level HTTP](/docs/low-level-http).

## Idempotency metadata and runtime policy

The route definition contains build-time metadata only. Request-time functions
belong in the application-wide endpoint runtime file:

```ts
export default defineRouteHandler({
  validate: {
    body: PaymentInput,
    response: { 201: Payment },
  },
  idempotency: {
    enabled: true,
    headerName: 'Idempotency-Key',
    required: true,
  },
  handler: (event) => event.respond(201, createPayment(event.validated.body)),
})
```

The central policy supplies `storage`, `scope`, and `authorization`. Route
overrides for `fingerprint`, replay statuses, and TTLs use
`routes[path][method].idempotency` in the same runtime file. This is required
for bodyless idempotent operations and multipart bodies containing `File`.
Putting these callbacks in the route definition is rejected so contract
discovery never evaluates application runtime dependencies during the build.

For application-wide policy and production storage requirements, see
[Idempotency](/docs/idempotency).

## Hooks

Application hooks and per-route overrides also live in
`server/endpoints/runtime.ts`:

```ts
export default defineEndpointRuntime({
  validation: {
    // The default is 'development'. Use 'always' at an untyped output boundary.
    response: 'development',
  },
  onValidationError: ({ kind, source }) => ({
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
  routes: {
    '/api/users/:id': {
      post: {
        onValidationError: (failure) => {
          if (failure.source === 'body') {
            return { status: 422, body: { error: 'invalid_user' } }
          }
        },
      },
    },
  },
})
```

A route validation hook may return nothing to fall through to the application
hook; the application hook may fall through to the built-in response.
`wrapHandler` is application-wide and wraps idempotency plus the handler; route
entries do not accept it. Runtime route keys must exactly match generated
templates and use lowercase methods; startup reports unmatched entries.

## Reusing schemas and metadata

Contract values are ordinary imports. Put reusable values outside route
directories, for example in `server/contracts`:

```ts
// server/contracts/user.ts
export const userContract = {
  params: UserParams,
  responses: { 200: User, 404: NotFound },
}
```

```ts
// server/api/users/[id].get.ts
import { userContract } from '../../../contracts/user'

export default defineRouteHandler({
  params: userContract.params,
  validate: { response: userContract.responses },
  handler: (event) => {
    return findUser(event.validated.params.id) ?? event.respond(404, { message: 'Not found' })
  },
})
```

There is no `*.endpoint-contract.ts` filename convention. On the current Nuxt 4
line the complete canonical route module is evaluated at build time, so keep
its top-level dependency graph deterministic. The project is working toward an
upstream contract carrier that can remove this evaluation requirement.

## Canonical macro-compatible form

Keep route declarations compatible with Nitro's compiler boundary:

- call the canonical `defineRouteHandler` identifier directly in the default
  export;
- pass an object literal as the first argument;
- do not alias or shadow the helper;
- do not use root or method-level spreads or computed properties;
- import reusable schema values instead of assembling the definition through
  runtime-only state.

Invalid or non-discoverable canonical routes fail generation rather than being
silently omitted.
