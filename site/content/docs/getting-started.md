---
title: Getting Started
description: Install the module and one schema library.
---

Zod, Valibot, and Effect are optional peer dependencies. Install the schema library you want to use in endpoint definitions.

## Compatibility

Nuxt Endpoints currently targets Nuxt 4.5+ with Nitro 2 and H3 1. Nuxt 5, Nitro 3, and H3 2 support is not claimed until those combinations are covered by the package test matrix.

## Install

Install with Zod:

```bash
vp add nuxt-endpoints zod
```

Install with Valibot:

```bash
vp add nuxt-endpoints valibot
```

Install with Effect Schema:

```bash
vp add nuxt-endpoints effect
```

## Configure Nuxt

Add `nuxt-endpoints` to `modules`. The generated OpenAPI route and optional client helpers can be configured through `endpoints`.

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
    },
  },
})
```

`openApi` can also be set to `false` to disable the generated schema route. By default, the schema route is only served in development; set `openApi: true` or `openApi.enabled: true` to also serve it in production. `client.result`, `client.raw`, and `client.effect` control which optional methods are generated on `$endpoint` calls.

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
