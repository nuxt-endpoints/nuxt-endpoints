---
title: Vue Query
description: Use typed endpoint request objects as Vue Query queries and mutations, with optional Nuxt SSR setup.
---

Nuxt Endpoints request objects produce ordinary Vue Query options. Nuxt Endpoints owns typed input, request identity, idempotency, and status-aware output; Vue Query owns caching, retries, invalidation, polling, and optimistic updates.

Install Vue Query as an optional peer dependency:

```bash
vp add @tanstack/vue-query
```

## Queries

`GET` and `HEAD` request objects expose `.queryOptions()`:

```ts
import { useQuery } from '@tanstack/vue-query'

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

The key includes the route method, path, and normalized request input. Ordinary headers and credentials are excluded. An idempotency key is included because it identifies the logical write and must remain stable across retries.

## Mutations

`POST`, `PUT`, `PATCH`, and `DELETE` request objects expose `.mutationOptions()`:

```ts
import { useMutation } from '@tanstack/vue-query'

const createPayment = useMutation(
  $endpoint('/api/payments', {
    method: 'post',
    body: { amount: 1000 },
  }).mutationOptions(),
)

createPayment.mutate()
```

One request object represents one logical mutation. Its automatically generated idempotency key remains fixed when Vue Query retries `mutationFn`. Create a new request object for a separate user action.

When each `mutate(...)` call supplies different variables, create the endpoint request inside a normal Vue Query mutation function:

```ts
const createUser = useMutation({
  mutationFn: async (name: string) => {
    const result = await $endpoint('/api/users', {
      method: 'post',
      body: { name },
    })
    if (!result.ok) throw result.body
    return result.body
  },
})
```

Use the `queryKey` returned by `.queryOptions()` with `invalidateQueries`, `prefetchQuery`, or `ensureQueryData`:

```ts
const usersRequest = $endpoint('/api/users', { method: 'get' })

await queryClient.invalidateQueries({
  queryKey: usersRequest.queryOptions().queryKey,
})
```

## Automatic SSR setup

Choose `auto` when the application does not already install Vue Query:

```ts
export default defineNuxtConfig({
  modules: ['nuxt-endpoints'],
  endpoints: {
    client: {
      query: {
        setup: 'auto',
        staleTime: 60_000,
      },
    },
  },
})
```

Auto mode creates a request-scoped `QueryClient`, installs `VueQueryPlugin`, transfers dehydrated state through Nuxt, and hydrates it in the browser. Do not combine it with another application-installed `VueQueryPlugin`.

Pages that require query data in server-rendered HTML must await the query during SSR:

```vue
<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { onServerPrefetch } from 'vue'

const user = useQuery(
  $endpoint('/api/users/:id', {
    method: 'get',
    params: { id: '123' },
  }).queryOptions(),
)

onServerPrefetch(() => user.suspense())
</script>
```

Query functions capture Nuxt's request-aware fetcher when the endpoint request is created, so incoming cookies reach relative internal routes during SSR. Construct requests inside component setup, a Nuxt plugin, or route middleware—not at module scope.

If the application already owns Vue Query setup, no Nuxt Endpoints query option is required. Install `VueQueryPlugin` with a request-scoped `QueryClient` and use the same request-object API.
