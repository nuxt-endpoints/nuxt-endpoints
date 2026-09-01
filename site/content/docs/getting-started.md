---
title: Getting Started
description: Install the module, define your first endpoint, and call it with types.
---

In a few minutes you will have a Nuxt route that validates its input at runtime, a client call with fully inferred types, and an OpenAPI document — all from one endpoint definition.

## Compatibility

Nuxt Endpoints currently targets Nuxt 4.5+ with Nitro 2 and H3 1. Nuxt 5, Nitro 3, and H3 2 support is not claimed until those combinations are covered by the package test matrix. This is a support statement, not a claim that newer combinations are known to fail.

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

Create an ordinary Nuxt server route and default-export a `defineEndpoint()` call with a `handler` property:

```ts
// server/api/users/[id].get.ts
import { z } from 'zod'

export default defineEndpoint({
  summary: 'Get a user',
  params: z.object({ id: z.coerce.number() }),
  responses: { 200: z.object({ id: z.number(), name: z.string() }) },
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
    client: {
      result: true,
      raw: true,
    },
  },
})
```

`openApi` can also be set to `false` to disable the generated schema route. By default, the schema route is only served in development; set `openApi: true` or `openApi.enabled: true` to also serve it in production. `client.result` and `client.raw` control which optional methods are generated on `$endpoint` calls.

To generate typed query, mutation, and infinite-query options for Vue Query, install
the optional peer and enable `client.query`:

```bash
vp add @tanstack/vue-query
```

```ts
export default defineNuxtConfig({
  modules: ['nuxt-endpoints'],
  endpoints: {
    client: {
      query: true,
    },
  },
})
```

`query: true` leaves QueryClient setup to the application. See
[Vue Query](/docs/tanstack-query) for generated factories and the opt-in
automatic Nuxt SSR setup.

## What gets generated

- `$endpoint`: a generated path/method client available in Nuxt app code.
- `#endpoints`: helper types for paths, optional operation targets, calls, status-aware typed results, and raw Web Responses.
- `#endpoints/query`: Query, Mutation, Infinite Query, and key factories when `client.query` is enabled.
- `/_endpoints/schema`: the default OpenAPI 3.1 document route when OpenAPI generation is enabled.

Adding the module changes nothing by itself: only routes that export an endpoint definition are affected. Existing routes keep working unchanged — see [Incremental Adoption](/docs/incremental-adoption).
