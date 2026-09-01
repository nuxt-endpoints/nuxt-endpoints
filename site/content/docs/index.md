---
title: Introduction
description: Typed APIs, generated clients, and OpenAPI for Nuxt server routes — from one endpoint definition.
---

Nuxt Endpoints lets you describe an HTTP endpoint once, next to its handler, with the schema library you already use — Zod, Valibot, or Effect Schema. Everything else is derived from that single definition:

- **Runtime validation** — `params`, `query`, `headers`, and `body` are validated before your handler runs. Handler code sees parsed schema output, so coercion and transforms are already applied.
- **A fully typed client** — `$endpoint` and `useEndpoint` are generated from your routes. Request options, success bodies, and declared error responses are all inferred. No codegen step, no types to import.
- **OpenAPI 3.1** — a document generated from the same schemas, served at `/_endpoints/schema`. There is no separate spec to maintain, so it cannot go stale.

## Show me

One route file declares the contract and the handler:

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
    const user = findUser(params.id) // params.id is a number — validated and coerced
    if (!user) return event.respond(404, { message: 'Not found' })
    return user
  },
})
```

Every component can now call it with full inference — including typed error branches:

```vue
<script setup lang="ts">
const result = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '1' },
})

if (result.status === 404) {
  result.body.message // typed as the 404 schema
}
</script>
```

Routes stay ordinary Nuxt server routes: plain HTTP, callable by mobile apps, other services, or `curl`, and documented via the generated OpenAPI document.

## Adopt at your own pace

Adding the module changes nothing by itself. Only routes that export an endpoint definition are affected; every other route keeps working exactly as before. See [Incremental Adoption](/docs/incremental-adoption).

> Status: early alpha. The core endpoint flow is usable, but some OpenAPI and discovery details are intentionally still conservative. See [Limits](/docs/limits).

## Next steps

- [Getting Started](/docs/getting-started) — install the module and define your first endpoint.
- [Define Endpoints](/docs/endpoints) — the full contract surface: request parts, multiple responses, validation options.
- [Generated Client](/docs/client) — everything `$endpoint` and `useEndpoint` can do.

Curious how it works and why it is designed this way? Read the [Mental Model](/docs/mental-model) and [Why Nuxt Endpoints?](/docs/why-nuxt-endpoints), or see how it [compares to alternatives](/docs/comparison).
