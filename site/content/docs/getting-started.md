---
title: Getting Started
description: Install the module, define your first endpoint, and call it with types.
---

In a few minutes you will have a Nuxt route that validates its input at runtime, a client call with fully inferred types, and an OpenAPI document — all from one endpoint definition.

## Compatibility

The examples below use the development version of Nuxt Endpoints with Nuxt 4.6, Nitro 2, and H3 1. Nuxt’s experimental route-typed fetch checks declared body and query inputs and infers successful responses. The module adds request header types and associates each declared HTTP status with its JSON body. On Nuxt 4.5, use the generated `$endpoint` and `useEndpoint` clients.

On Nuxt 4.7, you can also use the [experimental Nitro 3 setup](https://nuxt.com/docs/4.x/getting-started/upgrade#testing-nitro-v3). Add `nitro` to your app’s dependencies and keep Nuxt’s default `nitroLegacy` compatibility layer enabled. Nuxt Endpoints follows the Nitro version Nuxt selects for the app. The tested Nitro 3 version is `3.0.261103-rc`.

## Install

The Nuxt CLI installs the published module. The `validate` syntax and `client.nativeFetch` examples on this page require a build containing those changes.

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

Enable both options for the native fetch examples in this guide:

```ts
export default defineNuxtConfig({
  modules: ['nuxt-endpoints'],
  experimental: { routeTypedFetch: true },
  endpoints: { client: { nativeFetch: true } },
})
```

## Your first endpoint

Create an explicit, file-based Nuxt server route and default-export a
`defineEndpoint()` call. The route remains an HTTP endpoint; Nuxt Endpoints
adds the contract-aware handler API inside it.

```ts
// server/api/users/[id].get.ts
import { z } from 'zod'
export default defineEndpoint({
  summary: 'Get a user',
  validate: {
    params: z.object({ id: z.coerce.number() }),
  },
  responses: {
    200: z.object({ id: z.number(), name: z.string() }),
    404: z.object({ message: z.string() }),
  },
  handler: (event) => {
    const id = event.validated.params.id
    if (id === 1) return { id, name: 'Tom' }
    return event.respond(404, { message: 'User not found' })
  },
})
```

Call it from any component. Request options and the response type are inferred — there is no codegen step to run and no types to import:

```vue
<script setup lang="ts">
const { data, error } = await useFetch('/api/users/2')

if (error.value?.status === 404) console.log(error.value.data?.message)
else if (data.value) console.log(data.value.name)
</script>
```

Requests that do not match the contract are rejected before your handler runs — try `/api/users/abc` and the `z.coerce.number()` param fails validation.

While the dev server is running, the generated OpenAPI 3.1 document for this route is served at `/_endpoints/schema`.

From here:

- [Define Endpoints](/docs/endpoints) covers the full contract surface: validated request parts, multiple response statuses, and response validation.
- [Calling endpoints](/docs/client) covers `$fetch.raw`, `useFetch`, and the generated clients.

## Configure Nuxt

The Nuxt CLI adds `nuxt-endpoints` to `modules`. The generated OpenAPI route and optional client helpers can be configured through `endpoints`.

```ts
export default defineNuxtConfig({
  modules: ['nuxt-endpoints'],
  experimental: { routeTypedFetch: true },
  endpoints: {
    openApi: {
      path: '/_endpoints/schema',
      title: 'Example API',
      version: '1.0.0',
    },
    client: { nativeFetch: true, raw: true },
  },
})
```

`openApi` can also be set to `false` to disable the generated schema route. By default, the schema route is only served in development; set `openApi: true` or `openApi.enabled: true` to also serve it in production. `client.raw` controls whether `.raw()` is generated on `$endpoint` calls.

Shared application responses use the conventional `server/routes.config.ts` file. Set `endpoints.serverRouteConfig.path` only when that file lives elsewhere; see [Responses](/docs/responses#application-and-middleware-responses).

Nuxt Endpoints exposes typed adapters from `#endpoints/colada` for standard
Pinia Colada query, mutation, and infinite-query options. For cache, SSR, and
hydration support, install Colada and its official Nuxt modules:

```bash
vp add @pinia/colada @pinia/colada-nuxt pinia @pinia/nuxt
```

Add `@pinia/nuxt` and `@pinia/colada-nuxt` to `modules`; Nuxt Endpoints does not install a second cache plugin. See [Pinia Colada](/docs/pinia-colada) for `queryOptions()`, `mutationOptions()`, and cursor pagination.

## What gets generated

- `$endpoint`: a generated path/method client available in Nuxt app code.
- `#endpoints`: helper types for paths, methods, calls, status-aware typed results, and raw Web Responses.
- `/_endpoints/schema`: the default OpenAPI 3.1 document route when OpenAPI generation is enabled.

Adding the module changes nothing by itself: only routes whose default export is
a direct `defineEndpoint({...})` call are affected. Existing routes keep
working unchanged — see [Incremental Adoption](/docs/incremental-adoption).
