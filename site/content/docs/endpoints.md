---
title: Define Endpoints
description: Declare validated request and response contracts with the canonical route-handler API.
---

Nuxt Endpoints uses the same single-definition route shape being developed for
H3 and Nitro. Directly default-export `defineRouteHandler({...})`; the handler
receives parsed schema output.

```ts
// server/api/users/[id].get.ts
import { z } from 'zod'

export default defineRouteHandler({
  operation: 'getUser',
  params: z.object({ id: z.coerce.number() }),
  validate: {
    query: z.object({ include: z.string().optional() }),
    response: {
      200: z.object({ id: z.number(), name: z.string() }),
      404: z.object({ message: z.string() }),
    },
  },
  handler: ({ params, query, respond }) => {
    const user = findUser(params.id, query.include)
    return user ?? respond(404, { message: 'Not found' })
  },
})
```

On Nuxt 4/Nitro 2/H3 1, the module implements this API through a private
compatibility adapter. The authoring shape is intentionally identical to the
Nitro 3/H3 2 integration; `defineEndpoint*()` is no longer public API.

## Definition fields

Root fields describe route-wide metadata and path params:

- `operation`: optional unique client operation name.
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
    operation: 'getUser',
    validate: {
      response: { 200: User, 404: z.object({ message: z.string() }) },
    },
    handler: ({ params, respond }) => {
      return findUser(params.id) ?? respond(404, { message: 'Not found' })
    },
  },
  put: {
    operation: 'updateUser',
    validate: {
      body: z.object({ name: z.string() }),
      response: { 200: User },
    },
    handler: ({ params, body }) => updateUser(params.id, body),
  },
})
```

Use the single form in files such as `users.get.ts`; use the multi-method
form in a bare file such as `users.ts`. Mixing a multi-method definition with
a method-suffixed filename fails generation because the remaining methods
would be unreachable.

## Handler context

The compatibility adapter currently supplies:

- `params`, `query`, `headers`, and `body`: parsed schema outputs.
- `bodyMediaType`: selected request media type for a body map.
- `responseMediaType`: negotiated media response type.
- `respond(status, body, options?)`: typed status response.
- `event`: the native H3 event.
- `request`: a normalized Web `Request`.

```ts
export default defineRouteHandler({
  validate: {
    body: z.object({ name: z.string().trim() }),
    response: {
      201: z.object({ id: z.number(), name: z.string() }),
      409: z.object({ message: z.string() }),
    },
  },
  handler: async ({ body, respond }) => {
    if (await nameExists(body.name)) {
      return respond(409, { message: 'Already exists' })
    }
    return respond(201, await createUser(body))
  },
})
```

Returning a plain body is the status-200 shorthand. Use `respond` whenever
the status matters. TypeScript rejects a status or body not declared by the
response contract.

## Response validation

Response schemas always drive types and OpenAPI. Runtime response validation is
opt-in because it adds parsing work to every response:

```ts
export default defineRouteHandler(
  {
    validate: {
      response: { 200: z.object({ createdAt: z.date() }) },
    },
    handler: () => ({ createdAt: new Date() }),
  },
  {
    validation: { response: true },
  },
)
```

The server value is validated as `Date`; generated HTTP clients see the JSON
wire value as `string`.

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
  handler: ({ body, bodyMediaType, respond }) => {
    return respond(201, { ok: true })
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
  handler: ({ responseMediaType, respond }) => {
    const body =
      responseMediaType === 'application/json' ? JSON.stringify(rows) : createCsvStream(rows)
    return respond(200, body)
  },
})
```

Use `.raw()` for routes whose live stream or headers matter. See
[Low-level HTTP](/docs/low-level-http).

## Idempotency metadata and runtime policy

The first argument contains build-time metadata only. Request-time functions
belong in the optional second argument or the application-wide endpoint
runtime file:

```ts
export default defineRouteHandler(
  {
    operation: 'createPayment',
    validate: {
      body: PaymentInput,
      response: { 201: Payment },
    },
    idempotency: {
      enabled: true,
      headerName: 'Idempotency-Key',
      required: true,
    },
    handler: ({ body, respond }) => respond(201, createPayment(body)),
  },
  {
    idempotency: {
      storage: () => storage,
      scope: ({ event }) => event.context.user.id,
      authorization: 'middleware',
    },
  },
)
```

For application-wide policy and production storage requirements, see
[Idempotency](/docs/idempotency).

## Reusing schemas and metadata

Contract values are ordinary imports. Put reusable values outside route
directories, for example in `server/contracts`:

```ts
// server/contracts/user.ts
export const userContract = {
  operation: 'getUser',
  params: UserParams,
  responses: { 200: User, 404: NotFound },
}
```

```ts
// server/api/users/[id].get.ts
import { userContract } from '../../../contracts/user'

export default defineRouteHandler({
  operation: userContract.operation,
  params: userContract.params,
  validate: { response: userContract.responses },
  handler: ({ params, respond }) => {
    return findUser(params.id) ?? respond(404, { message: 'Not found' })
  },
})
```

There is no `*.endpoint-contract.ts` filename convention. On the Nitro 2
compatibility line the complete canonical route module is evaluated at build
time, so keep its top-level dependency graph deterministic. Nitro 3 replaces
this with handler-free AST extraction and a route-contract provider.

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
