---
title: Pinia Colada
description: Use typed endpoint request objects as Pinia Colada queries and mutations with its official Nuxt integration.
---

Nuxt Endpoints request objects produce ordinary Pinia Colada options. Nuxt Endpoints owns typed HTTP input, request identity, idempotency, and status-aware output; Pinia Colada owns server-state caching, invalidation, mutations, and optimistic updates.

Install Pinia Colada and its official Nuxt integration:

```bash
vp add @pinia/colada @pinia/colada-nuxt pinia @pinia/nuxt
```

```ts
export default defineNuxtConfig({
  modules: ['@pinia/nuxt', '@pinia/colada-nuxt', 'nuxt-endpoints'],
})
```

The Colada Nuxt module performs SSR prefetching, serialization, and hydration. Nuxt Endpoints does not install a second cache or hydration plugin.

## Queries

`GET` and `HEAD` request objects expose `.queryOptions()`:

```ts
import { useQuery } from '@pinia/colada'

const request = $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
})

const user = useQuery(request.queryOptions())

if (user.data.value?.status === 200) {
  user.data.value.body.name
}
```

The cached value is the serializable `{ status, ok, body }` union. Declared `404` or `422` responses remain typed data, while transport failures reject. Await `$endpoint(...)` directly when native response headers are required.

The key includes the route method, path, and a stable serialization of the request input. Ordinary headers and credentials are excluded. The query function captures Nuxt's request-aware fetcher when the request object is created, so incoming cookies reach relative internal routes during SSR.

## Mutations

`POST`, `PUT`, `PATCH`, and `DELETE` request objects expose `.mutationOptions()`:

```ts
import { useMutation } from '@pinia/colada'

const createPayment = useMutation(
  $endpoint('/api/payments', {
    method: 'post',
    body: { amount: 1000 },
  }).mutationOptions(),
)

createPayment.mutate()
```

One request object represents one logical mutation. Its automatically generated idempotency key remains fixed whenever that mutation is executed again. Create a new request object for a separate logical action.

When each `mutate(...)` call supplies different variables, create the endpoint request inside a normal Colada mutation function. Each invocation then receives a new idempotency key:

```ts
const createUser = useMutation({
  mutation: async (name: string) => {
    const result = await $endpoint('/api/users', {
      method: 'post',
      body: { name },
    })
    if (!result.ok) throw result.body
    return result.body
  },
})
```

Use the `key` returned by `.queryOptions()` with the Colada query cache:

```ts
import { useQueryCache } from '@pinia/colada'

const queryCache = useQueryCache()
const usersRequest = $endpoint('/api/users', { method: 'get' })

await queryCache.invalidateQueries({
  key: usersRequest.queryOptions().key,
})
```

## SSR

With `@pinia/colada-nuxt`, queries created during component setup are automatically prefetched during SSR and hydrated in the browser:

```vue
<script setup lang="ts">
import { useQuery } from '@pinia/colada'

const user = useQuery(
  $endpoint('/api/users/:id', {
    method: 'get',
    params: { id: '123' },
  }).queryOptions(),
)
</script>
```

Construct requests inside component setup, a Nuxt plugin, or route middleware—not at module scope—so each server request captures its own credentials. Configure cache defaults and plugins through Pinia Colada's standard `colada.options.ts` file.
