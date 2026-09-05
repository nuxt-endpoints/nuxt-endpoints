# Nuxt Endpoints

[![npm version](https://img.shields.io/npm/v/nuxt-endpoints/latest.svg?style=flat&colorA=18181B&colorB=28CF8D)](https://npmjs.com/package/nuxt-endpoints)
[![npm downloads](https://img.shields.io/npm/dm/nuxt-endpoints.svg?style=flat&colorA=18181B&colorB=28CF8D)](https://npm.chart.dev/nuxt-endpoints)
[![License](https://img.shields.io/npm/l/nuxt-endpoints.svg?style=flat&colorA=18181B&colorB=28CF8D)](https://github.com/nuxt-endpoints/nuxt-endpoints/blob/main/LICENSE)
[![Nuxt](https://img.shields.io/badge/Nuxt-18181B?logo=nuxt.js)](https://nuxt.com)

Typed APIs, generated clients, and OpenAPI for Nuxt server routes — from one endpoint definition.

- [📖 Documentation](https://nuxt-endpoints.github.io/nuxt-endpoints/)
- [🎮 Browser type playground](https://nuxt-endpoints.github.io/nuxt-endpoints/playground)
- [🧪 Nuxt 5 integration progress](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/nuxt5-progress)

> Status: beta. The core endpoint flow is usable, but some OpenAPI and discovery details are intentionally still conservative.

## Try the Nuxt 5 integration branch

The `nuxt5` branch integrates source changes that are not released by h3, Nitro, Nuxt, or
fetchdts yet. A normal package install is therefore not enough. From a fresh checkout, clone the
pinned public forks into the ignored `.upstream/` directory and build them before installing this
repository:

```bash
git clone --branch nuxt5 https://github.com/nuxt-endpoints/nuxt-endpoints.git
cd nuxt-endpoints

mkdir .upstream
git clone --depth 1 --branch prototype/route-contracts https://github.com/nuxt-endpoints/fetchdts.git .upstream/fetchdts
git clone --depth 1 --branch prototype/route-contracts https://github.com/nuxt-endpoints/h3.git .upstream/h3
git clone --depth 1 --branch prototype/route-contracts https://github.com/nuxt-endpoints/nitro.git .upstream/nitro
git clone --depth 1 --branch prototype/route-metadata https://github.com/nuxt-endpoints/nuxt.git .upstream/nuxt

git -C .upstream/fetchdts fetch --depth 1 origin de56ae24aea700c0ec2b26f8b56811fdd8940a63
git -C .upstream/h3 fetch --depth 1 origin 7f4c1c901a15e2a6ac5c217a20fb638a740240f4
git -C .upstream/nitro fetch --depth 1 origin cc9f56fcf2cc1bc8b19d1c81408853df8b1c7b07
git -C .upstream/nuxt fetch --depth 1 origin d9dab5edf132eb2ba7882966ff21e6ca1c427a32

git -C .upstream/fetchdts checkout --detach de56ae24aea700c0ec2b26f8b56811fdd8940a63
git -C .upstream/h3 checkout --detach 7f4c1c901a15e2a6ac5c217a20fb638a740240f4
git -C .upstream/nitro checkout --detach cc9f56fcf2cc1bc8b19d1c81408853df8b1c7b07
git -C .upstream/nuxt checkout --detach d9dab5edf132eb2ba7882966ff21e6ca1c427a32

(cd .upstream/fetchdts && vp install --frozen-lockfile && vp run build)
(cd .upstream/h3 && COREPACK_ENABLE_PROJECT_SPEC=0 vp install --frozen-lockfile && vp run build)
(cd .upstream/nitro && vp add -D typescript@npm:@typescript/typescript6@6.0.2 && vp run build)
(cd .upstream/nuxt && vp install --frozen-lockfile)

mkdir -p .upstream/nuxt/.prototype-pack
for package in schema kit nitro-server vite-server vite nuxt; do
  (cd ".upstream/nuxt/packages/$package" && vp pm pack --pack-destination ../../.prototype-pack)
done

vp install --no-frozen-lockfile -- --update-checksums
vp run dev:prepare
vp run check
```

The h3, Nitro, and fetchdts dependencies link directly to those visible source trees. The Nuxt
packages are packed locally from `.upstream/nuxt` only because their monorepo manifests use
`workspace:` dependencies; the tarballs are generated build inputs, not downloaded opaque forks.
Nitro temporarily uses the official TypeScript 6 compatibility package for its build tooling
because TypeScript 7 does not provide the stable Compiler API that its declaration build needs.
This changes only the build-time development dependency in the ignored Nitro clone; the Nuxt
Endpoints toolchain remains pinned by this repository. The CI workflow runs the same checkout and
preparation sequence.

## One definition, everything typed

For a runnable contract-to-client example, see the
[cursor pagination walkthrough](docs/pagination-demo.md): inspect the HTTP
fields, server type errors, and Pinia Colada page loading from one declaration.

Describe the HTTP contract once, next to the handler, with the schema library you already use (Zod, Valibot, or Effect Schema):

```ts
// server/api/users/[id].get.ts
import { z } from 'zod'
import { defineRouteHandler } from 'nuxt-endpoints/runtime'

export default defineRouteHandler({
  name: 'getUser',
  summary: 'Get a user',
  params: z.object({ id: z.coerce.number() }),
  validate: {
    response: {
      200: z.object({ id: z.number(), name: z.string() }),
      404: z.object({ message: z.string() }),
    },
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

Declared response bodies and headers are also checked while developing. Production skips that
second traversal by default; set `validation.response` in `server/endpoints/runtime.ts` to
`'always'` or `'never'` when the application needs a different policy.

**2. A contract-derived client** — no codegen step to run, no types to import:

```vue
<script setup lang="ts">
// The lazy request resolves to the declared status union.
const result = await $endpoint.getUser({
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
- ✅ Lazy `$endpoint` request objects: status unions and `.raw()`
- ✅ Optional named aliases such as `$endpoint.getUser({ params })`, while path and method stay canonical
- ✅ Status-aware `useEndpoint` composable wired into Nuxt async data (`key`, `lazy`, `watch`, …)
- ✅ SSR-correct without replacing Nuxt's transport: `useEndpoint` and the Colada query adapter forward the request the way `useFetch` does
- ✅ OpenAPI 3.1 generation, extensible via `document` / `extend`
- ✅ Importable path, method, request, and result helper types from `#endpoints`
- ✅ Pinia Colada integration through typed `queryOptions(request)` / `mutationOptions(request)` adapters, with its official Nuxt SSR module
- ✅ Contract-generated cursor pagination with a typed `infiniteQueryOptions(request)` Pinia Colada adapter — Nuxt 5 line only
- ✅ Optional `Idempotency-Key` replay protection with an application-owned durable storage contract and a development-only memory adapter
- ✅ Progressive enhancement: `useEndpointForm` projects GET query forms and POST mutation forms that work before hydration and with no JavaScript, from the same contract ([docs](./docs/progressive-enhancement.md)) — Nuxt 5 line only

## Published Nuxt 4 line

The package currently published to npm targets Nuxt 4 with Nitro 2 and h3 v1. Its source and
documentation live on the [`main` branch](https://github.com/nuxt-endpoints/nuxt-endpoints/tree/main).

```bash
npx nuxt module add nuxt-endpoints
```

Then install the schema library used by your endpoint definitions — `zod`, `valibot`, and `effect` are optional peer dependencies:

```bash
npm install zod
# or: npm install valibot
# or: npm install effect
```

Adding the module changes nothing by itself: only routes whose default export is a direct `defineRouteHandler({...})` call are affected, and existing routes keep working unchanged. Create a route like the one above and call it with `$endpoint`.

Module options (OpenAPI route and optional client methods) are configured under `endpoints` in `nuxt.config.ts` — see [Getting Started](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/getting-started).

Application or middleware responses shared by several routes can be declared by path in `server/routes.config.ts`; `$endpoint` and OpenAPI inherit those statuses without changing middleware execution.

## Documentation

Guides:

- [Getting Started](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/getting-started) — install, configure, and what gets generated
- [Define Endpoints](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/endpoints) — request parts, multiple responses, non-JSON responses, response validation
- [Generated Client](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/client) — `$endpoint`, `useEndpoint`, and helper types from `#endpoints`
- [Responses](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/responses) — status-aware and raw response shapes
- [Pinia Colada](https://nuxt-endpoints.github.io/nuxt-endpoints/docs/pinia-colada) — standard request-object query/mutation options and official Nuxt SSR setup
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

Maintainer design notes live in [`docs/`](./docs/roadmap.md). Upstream issues and
pull requests that can change the Nuxt 5 architecture are kept in the
[`upstream tracker`](./docs/upstream-tracking.md); the division of work across
H3, Nitro, Nuxt, fetchdts, ofetch, Nuxt Endpoints, and Pinia Colada is recorded
in the [`$endpoint` responsibility map](./docs/endpoint-responsibilities.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, checks, and guidelines.

## License

[MIT](./LICENSE). See [Third-Party Notices](./THIRD_PARTY_NOTICES.md) for
attributions that apply to bundled documentation assets.
