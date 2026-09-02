---
title: Getting Started
description: Install the module, define your first endpoint, and call it with types.
---

In a few minutes you will have a Nuxt route that validates its input at runtime, a client call with fully inferred types, and an OpenAPI document — all from one endpoint definition.

## Compatibility

Nuxt Endpoints targets Nuxt 5 with Nitro 3 and h3 v2. It currently resolves forks of h3, Nitro, Nuxt, and fetchdts that carry route-contract work not yet released upstream, so this is an integration branch rather than a support claim for published packages. The Nuxt 4 / Nitro 2 / h3 v1 line lives on the `main` branch.

This section is the single source for the supported platform line; other pages link here instead of restating it.

## Install

Add Nuxt Endpoints through the Nuxt CLI:

```bash
npx nuxt module add nuxt-endpoints
```

Then install the schema library you want to use in endpoint definitions — Zod, Valibot, and Effect are optional peer dependencies:

```bash
npm install zod
```

Install with Valibot:

```bash
npm install valibot
```

Install with Effect Schema:

```bash
npm install effect
```

## Your first endpoint

Create an ordinary Nuxt server route and default-export a `defineRouteHandler()` call:

```ts
// server/api/users/[id].get.ts
import { z } from 'zod'
import { defineRouteHandler } from 'nuxt-endpoints/runtime'

export default defineRouteHandler({
  summary: 'Get a user',
  params: z.object({ id: z.coerce.number() }),
  validate: {
    response: { 200: z.object({ id: z.number(), name: z.string() }) },
  },
  handler: (event) => {
    return { id: event.validated.params.id, name: 'Tom' } // params.id is a number — validated and coerced
  },
})
```

Call it from any component. Request options and the response type are inferred — there is no codegen step to run and no types to import:

```vue
<script setup lang="ts">
const result = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '1' },
})

if (result.status === 200) result.body.name.toUpperCase()
</script>
```

Requests that do not match the contract are rejected before your handler runs — try `/api/users/abc` and the `z.coerce.number()` param fails validation.

While the dev server is running, the generated OpenAPI 3.1 document for this route is served at `/_endpoints/schema`.

From here:

- [Define Endpoints](/docs/endpoints) covers the full contract surface: validated request parts, multiple response statuses, and response validation.
- [Generated Client](/docs/client) covers everything `$endpoint` and `useEndpoint` can do.

## Configure Nuxt

The Nuxt CLI adds `nuxt-endpoints` to `modules`. The generated OpenAPI route and optional client helpers can be configured through `endpoints`.

```ts
export default defineNuxtConfig({
  modules: ['nuxt-endpoints'],
  endpoints: {
    openApi: {
      path: '/_endpoints/schema',
      title: 'Example API',
      version: '1.0.0',
    },
    client: { raw: true },
  },
})
```

`openApi` can also be set to `false` to disable the generated schema route. By default, the schema route is only served in development; set `openApi: true` or `openApi.enabled: true` to also serve it in production. `client.raw` controls whether `.raw()` is generated on `$endpoint` calls.

Endpoint request objects expose standard Pinia Colada query and mutation options. For cache, SSR, and hydration support, install Colada and its official Nuxt modules:

```bash
vp add @pinia/colada @pinia/colada-nuxt pinia @pinia/nuxt
```

Add `@pinia/nuxt` and `@pinia/colada-nuxt` to `modules`; Nuxt Endpoints does not install a second cache plugin. See [Pinia Colada](/docs/pinia-colada) for `.queryOptions()` and `.mutationOptions()`.

## What gets generated

- `$endpoint`: a generated path/method client available in Nuxt app code.
- `#endpoints`: helper types for paths, methods, calls, status-aware typed results, and raw Web Responses.
- `/_endpoints/schema`: the default OpenAPI 3.1 document route when OpenAPI generation is enabled.

Adding the module changes nothing by itself: only routes whose default export is a direct `defineRouteHandler({...})` call are affected. Existing routes keep working unchanged — see [Incremental Adoption](/docs/incremental-adoption).
