# Nuxt Endpoints

[![npm version](https://img.shields.io/npm/v/nuxt-endpoints/latest.svg?style=flat&colorA=18181B&colorB=28CF8D)](https://npmjs.com/package/nuxt-endpoints)
[![npm downloads](https://img.shields.io/npm/dm/nuxt-endpoints.svg?style=flat&colorA=18181B&colorB=28CF8D)](https://npm.chart.dev/nuxt-endpoints)
[![License](https://img.shields.io/npm/l/nuxt-endpoints.svg?style=flat&colorA=18181B&colorB=28CF8D)](https://github.com/nuxt-endpoints/nuxt-endpoints/blob/main/LICENSE)
[![Nuxt](https://img.shields.io/badge/Nuxt-18181B?logo=nuxt.js)](https://nuxt.com)

Typed APIs, generated clients, and OpenAPI for Nuxt server routes — from one endpoint definition.

- [📖 Documentation](https://nuxt-endpoints.github.io/nuxt-endpoints/)
- [🎮 Browser type playground](https://nuxt-endpoints.github.io/nuxt-endpoints/playground)

> Status: early alpha. The core endpoint flow is usable, but some OpenAPI and discovery details are intentionally still conservative.

## One definition, everything typed

Describe the HTTP contract once, next to the handler, with the schema library you already use (Zod, Valibot, or Effect Schema):

```ts
// server/api/users/[id].get.ts
import { z } from 'zod'

export default defineEndpoint({
  summary: 'Get a user',
  params: z.object({ id: z.coerce.number() }),
  responses: {
    200: z.object({ id: z.number(), name: z.string() }),
    404: z.object({ message: z.string() }),
  },
  handler: (event) => {
    const { params } = event.validated
    const user = findUser(params.id) // params.id is a number — already validated and coerced
    if (!user) return event.respond(404, { message: 'Not found' })
    return user
  },
})
```

That single definition gives you:

**1. Runtime validation** — `params`, `query`, `headers`, and `body` are validated before the handler runs. Handler code sees the parsed schema output, so coercion and transforms are already applied.

**2. A fully typed client** — no codegen step to run, no types to import:

```vue
<script setup lang="ts">
// The lazy request resolves to the declared status union.
const result = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '1' },
})

if (result.status === 404) {
  result.body.message // typed as the 404 schema
}
</script>
```

**3. An OpenAPI 3.1 document** — served at `/_endpoints/schema` in dev, generated from the same schemas. No separate spec to maintain.

Routes stay ordinary Nuxt server routes: plain HTTP, callable by mobile apps, other services, or `curl`.

## Features

- ✅ Schema-agnostic: Zod v4, Valibot, and Effect Schema (Standard Schema based)
- ✅ Request validation for `params`, `query`, `headers`, and `body`
- ✅ Multiple response statuses, checked at the type level via `respond(status, body)`
- ✅ Lazy `$endpoint` request objects: status unions, `.raw()`, `.queryOptions()`, `.mutationOptions()`
- ✅ Status-aware `useEndpoint` composable wired into Nuxt async data (`key`, `lazy`, `watch`, …)
- ✅ SSR-correct without replacing Nuxt's transport: `useEndpoint` and the query factories forward the request the way `useFetch` does
- ✅ OpenAPI 3.1 generation, extensible via `document` / `extend`
- ✅ Optional named operations (`$endpoint.getUser(...)`) and importable types from `#endpoints`
- ✅ Generated TanStack/Vue Query adapter: `useQuery` / `useMutation` / `useInfiniteQuery` option factories from named endpoints, with optional Nuxt SSR setup
- ✅ Optional `Idempotency-Key` replay protection with an application-owned durable storage contract and a development-only memory adapter

## Quick Start

Requires Nuxt 4.5 or newer — see [Compatibility](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/getting-started#compatibility) for the supported platform line.

```bash
npx nuxt module add nuxt-endpoints
```

Then install the schema library used by your endpoint definitions — `zod`, `valibot`, and `effect` are optional peer dependencies:

```bash
npm install zod
# or: npm install valibot
# or: npm install effect
```

That's it. Adding the module changes nothing by itself: only routes that export an endpoint definition are affected, and existing routes keep working unchanged. Create a route like the one above and call it with `$endpoint`.

Module options (OpenAPI route, optional client methods, the Vue Query adapter) are configured under `endpoints` in `nuxt.config.ts` — see [Getting Started](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/getting-started).

## Documentation

Guides:

- [Getting Started](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/getting-started) — install, configure, and what gets generated
- [Define Endpoints](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/endpoints) — request parts, multiple responses, non-JSON responses, response validation
- [Generated Client](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/client) — `$endpoint`, `useEndpoint`, and helper types from `#endpoints`
- [Responses](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/responses) — status-aware and raw response shapes
- [Vue Query](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/tanstack-query) — generated TanStack Vue Query option factories and SSR setup
- [OpenAPI](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/openapi) — schema route, document metadata, `document` / `extend`
- [Schema Libraries](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/schema-libraries) — Zod v4, Valibot, and Effect Schema specifics
- [Idempotency](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/idempotency) — optional `Idempotency-Key` replay protection
- [Low-level HTTP](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/low-level-http) — files, redirects, proxies, and raw responses
- [Incremental Adoption](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/incremental-adoption) — convert routes one at a time

Concepts, for when you want the reasoning behind the design:

- [Why Nuxt Endpoints?](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/why-nuxt-endpoints) — the drift problem and the single-contract idea
- [Comparison](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/comparison) — vs plain `$fetch` typing, tRPC, and spec-first codegen
- [Mental Model](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/mental-model) — how the pieces fit together
- [Limits](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/limits) — supported platform line, known constraints, and planned work

Maintainer design notes and the detailed roadmap live in [`docs/`](./docs/roadmap.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, checks, and guidelines.

## License

[MIT](./LICENSE). See [Third-Party Notices](./THIRD_PARTY_NOTICES.md) for
attributions that apply to bundled documentation assets.
