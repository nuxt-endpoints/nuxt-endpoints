---
title: Introduction
description: Validate a Nuxt route and get status-aware response types in $fetch and useFetch.
---

Start with one server route. Declare its inputs and HTTP responses with Zod, Valibot, or Effect Schema. The same schemas drive validation on the server, types in your Nuxt client, and the OpenAPI document.

- **Runtime validation** — `params`, `query`, `headers`, and `body` are validated before your handler runs. Handler code sees parsed schema output, so coercion and transforms are already applied.
- **Nuxt 4.6 typed fetch** — Nuxt infers declared body and query inputs and successful responses. Enable the module’s native fetch types to narrow declared JSON error bodies by HTTP status.
- **OpenAPI 3.1** — a document generated from the same schemas, served at `/_endpoints/schema`. There is no separate spec to maintain, so it cannot go stale.
- **Progressive forms** — `useEndpointForm` projects native GET and POST forms from the same contract, including no-JavaScript submissions and typed enhanced results.

## Show me

One route file declares the contract and the handler:

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
    const { params } = event.validated
    const user = findUser(params.id) // params.id is a number — validated and coerced
    if (!user) return event.respond(404, { message: 'Not found' })
    return user
  },
})
```

With [native fetch types enabled](/docs/client#nuxt-fetch-types), a component can read the declared 404 body:

```vue
<script setup lang="ts">
const { error } = await useFetch('/api/users/1')
if (error.value?.status === 404) {
  console.log(error.value.data?.message)
}
</script>
```

The boundary stays an explicit, file-based Nuxt HTTP route, callable by mobile
apps, other services, or `curl`, and documented through the generated OpenAPI
document.

## Adopt at your own pace

Adding the module changes nothing by itself. Only routes that directly default-export `defineEndpoint({...})` are affected; every other route keeps working exactly as before. See [Incremental Adoption](/docs/incremental-adoption).

## Next steps

- [Getting Started](/docs/getting-started) — install the module and define your first endpoint.
- [Define Endpoints](/docs/endpoints) — the full contract surface: request parts, multiple responses, validation options.
- [Calling endpoints](/docs/client) — status-aware `$fetch.raw`, `useFetch`, and generated clients.

Curious how it works and why it is designed this way? Read the [Mental Model](/docs/mental-model) and [Why Nuxt Endpoints?](/docs/why-nuxt-endpoints), or see how it [compares to alternatives](/docs/comparison).
