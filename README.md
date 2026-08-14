# Nuxt Endpoints

[![npm version](https://img.shields.io/npm/v/nuxt-endpoints/latest.svg?style=flat&colorA=18181B&colorB=28CF8D)](https://npmjs.com/package/nuxt-endpoints)
[![npm downloads](https://img.shields.io/npm/dm/nuxt-endpoints.svg?style=flat&colorA=18181B&colorB=28CF8D)](https://npm.chart.dev/nuxt-endpoints)
[![License](https://img.shields.io/npm/l/nuxt-endpoints.svg?style=flat&colorA=18181B&colorB=28CF8D)](https://github.com/nuxt-endpoints/nuxt-endpoints/blob/main/LICENSE)
[![Nuxt](https://img.shields.io/badge/Nuxt-18181B?logo=nuxt.js)](https://nuxt.com)

Typed APIs, generated clients, and OpenAPI for Nuxt server routes — from one endpoint definition.

- [📖 Documentation](https://nuxt-endpoints.github.io/nuxt-endpoints/)
- [🎮 Browser type playground](https://nuxt-endpoints.github.io/nuxt-endpoints/playground)

> Status: early alpha. The core endpoint flow is usable, but some OpenAPI and discovery details are intentionally still conservative.

## The problem

In a plain Nuxt app, your server routes and your client calls drift apart:

- `getQuery` / `readBody` give you `unknown`-ish data — nothing validates the request before your handler runs.
- `$fetch` infers the _serialized return type_, but request params, query, and bodies are untyped, and error responses are `unknown`.
- If you need OpenAPI for external consumers, you maintain it by hand — and it silently goes stale.

## The idea

Define the HTTP contract once, next to the handler, with the schema library you already use (Zod, Valibot, or Effect Schema). Everything else is derived from it:

```ts
// server/api/users/[id].get.ts
import { z } from 'zod'

export const endpoint = defineEndpoint({
  summary: 'Get a user',
  params: z.object({ id: z.coerce.number() }),
  responses: {
    200: z.object({ id: z.number(), name: z.string() }),
    404: z.object({ message: z.string() }),
  },
})

export default defineEndpointHandler(endpoint, ({ params, respond }) => {
  const user = findUser(params.id) // params.id is a number — already validated and coerced
  if (!user) return respond(404, { message: 'Not found' })
  return user
})
```

That single definition gives you:

**1. Runtime validation** — `params`, `query`, `headers`, and `body` are validated before the handler runs. Handler code sees the schema _output_ types, so coercion and transforms are reflected.

**2. A fully typed client** — no codegen step to run, no types to import:

```vue
<script setup lang="ts">
// Success-body call: request options and response are inferred
const user = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '1' },
})

// Status-typed call: branch on declared responses
const result = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '1' },
}).result()

if (result.status === 404) {
  result.body.message // typed as the 404 schema
}
</script>
```

**3. An OpenAPI 3.1 document** — served at `/_endpoints/schema` in dev, generated from the same schemas. No separate spec to maintain.

## Why not…?

- **Plain `$fetch` typing** — Nuxt already infers server-route return types, but there is no request validation, no typed error responses, and no OpenAPI. Nuxt Endpoints keeps that workflow (routes stay ordinary files under `server/api`) and adds the contract on top.
- **tRPC** — great end-to-end typing, but it replaces REST with its own protocol. Endpoints here stay plain HTTP routes: callable by mobile apps, other services, or `curl`, and documented via OpenAPI.
- **Spec-first codegen** (`openapi-typescript` and friends) — the spec is the artifact, not the source, so it drifts from the handlers. Here the contract lives next to the handler and the spec is generated.

## Features

- ✅ Schema-agnostic: Zod v4, Valibot, and Effect Schema (Standard Schema based)
- ✅ Request validation for `params`, `query`, `headers`, and `body`
- ✅ Multiple response statuses, checked at the type level via `respond(status, body)`
- ✅ Generated `$endpoint` client: success-body calls, `.result()`, `.raw()`, optional `.effect()`
- ✅ `useEndpoint` composable wired into Nuxt async data (`key`, `lazy`, `watch`, …)
- ✅ OpenAPI 3.1 generation, extensible via `document` / `extend`
- ✅ Optional named operations (`$endpoint.getUser(...)`) and importable types from `#endpoints`
- ✅ Generated TanStack/Vue Query adapter: `useQuery` / `useMutation` / `useInfiniteQuery` option factories from named endpoints, with optional Nuxt SSR setup
- ✅ Optional `Idempotency-Key` replay protection with an application-owned durable storage contract and a development-only memory adapter

## Install

Requires Nuxt 4.5 or newer on the Nitro 2 / H3 1 platform line. Nuxt 5, Nitro 3, and H3 2 support is not claimed yet.

```bash
vp add nuxt-endpoints zod
```

Valibot and Effect Schema are also supported:

```bash
vp add nuxt-endpoints valibot
# or
vp add nuxt-endpoints effect
```

`zod`, `valibot`, and `effect` are optional peer dependencies. Install the schema library you use in your endpoint definitions.

## Setup

Add the module to `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['nuxt-endpoints'],
  endpoints: {
    openApi: {
      path: '/_endpoints/schema',
      title: 'Example API',
      version: '1.0.0',
    },
    client: {
      result: true,
      raw: true,
      effect: false,
      query: true, // or: { setup: 'external' | 'auto', staleTime: 60000 }
    },
  },
})
```

`openApi` can also be set to `false` to disable the generated schema route.
By default, the schema route is only served in development; set `openApi: true`
or `openApi.enabled: true` to also serve it in production.
Use `client.result`, `client.raw`, `client.effect`, and `client.query` to
control which optional methods and adapters are generated on `$endpoint`
calls. `result` and `raw` default to `true`; `effect` and `query` default to
`false`. `client.query: true` uses the conservative `external` setup mode
(your app owns the `QueryClient`); `client.query.setup: 'auto'` has the
module own the Vue Query plugin and SSR wiring instead, with `staleTime`
defaulting to `60000` ms. See the [Vue Query docs](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/tanstack-query) for details.

## Define Endpoints

Create a Nuxt server route, export its endpoint definition, and default-export the handler:

```ts
// server/api/users/[id].get.ts
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
  response: User,
})

export default defineEndpointHandler(endpoint, ({ params }) => {
  return {
    id: params.id,
    name: 'Tom',
  }
})
```

Request parts are validated before the handler runs:

- `params`
- `query`
- `headers`
- `body`

The handler context uses the schema output type, so coercion and transforms are reflected in handler code.

The generated client can call this route by path and method. Add `operation` only when you also want a named call target such as `$endpoint('getUser', ...)` or a hand-picked OpenAPI operationId.

## Multiple Responses

Declare non-200 responses with `responses` and return them with `respond`:

```ts
import { z } from 'zod'

const User = z.object({
  id: z.number(),
  name: z.string(),
})

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

  return {
    id: params.id,
    name: 'Tom',
  }
})
```

TypeScript checks that returned bodies match the declared response schemas. Response validation at runtime is optional:

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

export default defineEndpointHandler(endpoint, () => {
  return { id: 1, name: 'Tom' }
})
```

## Generated Client

Nuxt Endpoints generates `$endpoint` from discovered endpoint definitions:

```vue
<script setup lang="ts">
const user = await $endpoint('/api/users/:id', {
  method: 'get',
  params: {
    id: '1',
  },
})
</script>
```

The default call is a data client: `await` returns the success body and non-2xx responses follow `$fetch` error behavior.

Add `operation` when you want a named call target such as `$endpoint('getUser', ...)`.

Use `useEndpoint` when the same typed call should be managed by Nuxt async data:

```vue
<script setup lang="ts">
const {
  data: user,
  pending,
  error,
  refresh,
} = await useEndpoint('/api/users/:id', {
  method: 'get',
  params: { id: '1' },
  key: 'user:1',
})

user.value?.name.toUpperCase()
</script>
```

When the route declares `operation`, the same composable can use the operation name without
passing `method`:

```ts
const { data: user } = await useEndpoint('getUser', {
  params: { id: '1' },
})
```

`useEndpoint` forwards Nuxt async-data options such as `key`, `lazy`, `server`,
`watch`, and `default`, while keeping endpoint request options typed.

Use `.result()` when you need typed HTTP status, headers, and response body:

```ts
const result = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
}).result()

if (result.status === 200) {
  result.body.id
}

if (result.status === 404) {
  result.body.message
}
```

Use `.raw()` when you want a low-level Web `Response` value with typed `json()`:

```ts
const response = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
}).raw()

if (response.status === 200) {
  const body = await response.json()
  body.id
}
```

The client input type is inferred from the endpoint request schema. The client response type is inferred from the endpoint response schema.

To add Effect calls, install `effect` and enable the generated Effect adapter:

```ts
export default defineNuxtConfig({
  modules: ['nuxt-endpoints'],
  endpoints: {
    client: {
      result: true,
      raw: true,
      effect: true,
    },
  },
})
```

```ts
const userProgram = $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
}).effect()
```

`.effect()` wraps the status-typed `.result()` shape. HTTP statuses stay in the
typed result value, while transport failures use the Effect error channel.
Effect calls are lazy and re-run the underlying request for each Effect execution
or retry. Effect interruptions are forwarded to `$fetch` with `AbortSignal`.

Non-2xx `.effect()` results do not fail the Effect. Branch on the typed status:

```ts
const user = await $endpoint('/api/users/:id', { method: 'get', params: { id: '123' } })
  .effect()
  .pipe(
    Effect.retry({ times: 2 }),
    Effect.map((result) => (result.status === 404 ? null : result.body)),
    Effect.runPromise,
  )
```

You can also import generated types:

```ts
import type {
  $EndpointCall,
  $EndpointPathCall,
  $EndpointPathResponse,
  $EndpointRawResponse,
  $EndpointResult,
  $EndpointResponse,
  EndpointMethod,
  EndpointOperation,
  EndpointPath,
} from '#endpoints'

type Path = EndpointPath
type GetUserMethod = EndpointMethod<'/api/users/:id'>
type GetUserResponse = $EndpointPathResponse<'/api/users/:id', 'get'>
type GetUserCall = $EndpointPathCall<'/api/users/:id', 'get'>

// Operation helpers are available when the route declares operation: 'getUser'.
type Operation = EndpointOperation
type GetUserOperationResponse = $EndpointResponse<'getUser'>
type GetUserOperationCall = $EndpointCall<'getUser'>
type GetUserOperationResult = $EndpointResult<'getUser'>
type GetUserOperationRawResponse = $EndpointRawResponse<'getUser'>
```

## Server State with Vue Query

Enable with `endpoints: { client: { query: true } }` to generate `#endpoints/query`. `@tanstack/vue-query` is an optional peer dependency — install it separately.

Generated factories depend on the endpoint's HTTP method: `GET` and `HEAD` routes get `endpointQueryOptions` and `endpointInfiniteQueryOptions`; `POST`, `PUT`, `PATCH`, and `DELETE` routes get `endpointMutationOptions`. Factories require a named `operation`.

Vue Query owns caching, invalidation, and retries. Nuxt Endpoints only keeps request and response types aligned with the server contract.

```ts
import { useQuery } from '@tanstack/vue-query'
import { endpointQueryOptions } from '#endpoints/query'

const user = useQuery(
  endpointQueryOptions.getUser({
    params: { id: '123' },
  }),
)
```

See the [Vue Query](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/tanstack-query) docs for setup modes and full usage.

## Idempotency

Optional `Idempotency-Key` replay protection is declared with the immutable `.idempotency(options)` method on a `defineEndpoint(...)` result. It returns a new endpoint and does not mutate the original.

The endpoint definition only gains serializable, client-safe metadata (`{ enabled, headerName, required }`). Storage, scope, and authorization callbacks stay in private server runtime options and never leak into generated client types.

```ts
import { z } from 'zod'
import { createMemoryIdempotencyStorage } from 'nuxt-endpoints/runtime'

const storage = createMemoryIdempotencyStorage()

export const endpoint = defineEndpoint({
  operation: 'grantPoints',
  body: z.object({ userId: z.string(), amount: z.number().int().positive() }),
  responses: {
    201: z.object({ balance: z.number() }),
  },
}).idempotency({
  storage: () => storage,
  scope: ({ event }) => event.context.tenantId,
  authorization: 'middleware',
  required: true,
  replayStatuses: [201],
})

export default defineEndpointHandler(endpoint, ({ body, respond }) => {
  return respond(201, { balance: grantPoints(body.userId, body.amount) })
})
```

- `storage` returns an application-owned durable `IdempotencyStorage` adapter. It must not open a connection per request.
- `scope` returns a trusted server-derived string (e.g. authenticated tenant/user id), never a client-controlled value.
- `authorization` is either a callback run on every request (including replays) or the literal `'middleware'`, asserting that Nitro middleware already authorized the request.
- `required` (default `false`) makes the `Idempotency-Key` header mandatory.
- `replayStatuses` opts additional declared statuses into replay; successful `2xx` responses are recorded by default.

The generated client accepts a typed `idempotencyKey` request option, separate from `headers`, that maps to the configured header — required in the client type when `required: true`, optional otherwise.

`createMemoryIdempotencyStorage()` is a process-local development/test store only. Production deployments must supply a durable adapter (Redis, SQL, …) implementing the `IdempotencyStorage` contract. This does not guarantee exactly-once side effects — it protects the replay record and coordinates retries. The default header name is `Idempotency-Key`, overridable via `headerName`.

## OpenAPI

By default, Nuxt Endpoints serves an OpenAPI 3.1 document at:

```txt
/_endpoints/schema
```

Configure it with module options:

```ts
export default defineNuxtConfig({
  modules: ['nuxt-endpoints'],
  endpoints: {
    openApi: {
      enabled: true,
      path: '/openapi.json',
      title: 'Example API',
      version: '1.0.0',
    },
  },
})
```

For lower-level usage, `createOpenApiDocument` can generate a document from route definitions:

```ts
import { createOpenApiDocument } from 'nuxt-endpoints/runtime'

const document = createOpenApiDocument(routes, {
  title: 'Example API',
  version: '1.0.0',
  document: {
    servers: [{ url: 'https://api.example.com' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  extend(document) {
    document.paths['/api/users/{id}'].get.security = [{ bearerAuth: [] }]
  },
})
```

OpenAPI-specific details that are not part of the endpoint definition can be added with `document` or `extend`.

## Schema Support

Zod v4 schemas are converted through `@asteasolutions/zod-to-openapi`.

```ts
import { z } from 'zod'

defineEndpoint({
  body: z.object({
    name: z.string().min(1),
  }),
  response: z.object({
    id: z.number().int(),
    name: z.string(),
  }),
})
```

Valibot schemas are converted through `@valibot/to-json-schema` with JSON Schema 2020-12 output.

```ts
import * as v from 'valibot'

const Id = v.pipe(v.string(), v.transform(Number), v.number())

defineEndpoint({
  body: v.object({ id: Id }), // OpenAPI request schema: string
  response: v.object({ id: Id }), // OpenAPI response schema: number
})
```

For Valibot, request-side OpenAPI schemas use input mode and response-side schemas use output mode.

Effect Schema can be passed directly to endpoint definitions. Runtime parsing uses Effect's Standard Schema adapter and OpenAPI generation uses Effect's JSON Schema converter.

```ts
import { Schema } from 'effect'

defineEndpoint({
  params: Schema.Struct({
    id: Schema.NumberFromString,
  }),
  response: Schema.Struct({
    id: Schema.Number,
    name: Schema.String,
  }),
})
```

Effect schemas with runtime requirements are outside the supported contract surface. Use schemas whose `Context` is `never`.

## Development

Type checks run on TypeScript 7. The Nuxt module builder and the browser-based
type playground use the official TypeScript 6 compatibility package because
TypeScript 7 does not expose the Compiler API yet.

```bash
vp install
vp run check
vp run build
vp run site:dev
vp run site:generate
vp run dev
```

The integration test fixture verifies:

- Nuxt route discovery.
- Generated `#endpoints` types.
- Generated `$endpoint` client typing.
- Runtime success and error responses through Nuxt.
- OpenAPI document generation from endpoint definitions.

## Current Limitations

- Endpoint discovery first evaluates server route modules during Nuxt/Nitro type generation and reads endpoint metadata from the exported handler. Keep route module top-level code lightweight and avoid side effects.
- If route module evaluation fails, Nuxt Endpoints falls back to source parsing for literal `operation` values inside direct `defineEndpoint({ ... })` definitions. This fallback does not support variables, spreads, aliases, or factory wrappers.
- Request and response bodies currently use JSON by default. First-class multiple media types, request encodings, and content negotiation are not yet part of the endpoint definition.
- OpenAPI `security`, cookies, examples, encoding, links, and some component-level details can be added through `document` / `extend`, but they are not first-class endpoint fields yet.
- Validator-to-schema conversion is delegated to validator-specific libraries. Unsupported Zod, Valibot, or Effect Schema constructs fail according to those libraries' behavior.
- Zod support targets Zod v4. Zod v3 is intentionally not supported.
- Zod and Valibot conversion dependencies are currently loaded by the runtime bundle. Effect Schema support loads Effect adapters only when an Effect schema is used.
- Effect calls currently use Nuxt `$fetch` directly and return `Effect<Success, Error, never>`. Effect `Layer` / `Context` based fetcher injection is not implemented yet.

## Planned Work

Detailed priorities and design notes are tracked in the
[design roadmap](./docs/roadmap.md).

- Work with Nuxt/Nitro on a stable public build-time route metadata API so modules can collect endpoint metadata without evaluating route modules or relying on source parsing.
- Add a first-class endpoint metadata story for OpenAPI-specific fields without making the core API OpenAPI-shaped.
- Add better OpenAPI component/reference controls for shared schemas.
- Expand the Effect adapter once the API shape is clear: fetcher/auth/baseURL/tracing injection through `Layer` / `Context`, test mock injection, Effect `Stream` support for SSE/binary/download responses, and automatic tracing/metrics annotations with endpoint operation names.
- Add Nuxt 5, Nitro 3, and H3 2 coverage after their integration APIs stabilize.

## License

[MIT](./LICENSE)
