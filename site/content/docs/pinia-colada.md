---
title: Pinia Colada
description: Use typed endpoint request objects as Pinia Colada queries and mutations with its official Nuxt integration.
---

Nuxt Endpoints converts its request objects into ordinary Pinia Colada options. Nuxt Endpoints owns typed HTTP input, request identity, idempotency, and status-aware output; Pinia Colada owns server-state caching, invalidation, mutations, and optimistic updates.

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

`queryOptions()` accepts only `GET` and `HEAD` endpoint requests:

```ts
import { useQuery } from '@pinia/colada'
import { queryOptions } from '#endpoints/colada'

const request = $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
})

const user = useQuery(queryOptions(request))

if (user.data.value?.status === 200) {
  user.data.value.body.name
}
```

The cached value is the serializable `{ status, ok, body }` union. Declared `404` or `422` responses remain typed data, while transport failures reject. Await `$endpoint(...)` directly when native response headers are required.

The key includes the route method, path, and a stable serialization of the request input. Ordinary headers and credentials are excluded. The query function captures Nuxt's request-aware fetcher when the request object is created, so incoming cookies reach relative internal routes during SSR.

## Mutations

`mutationOptions()` accepts only `POST`, `PUT`, `PATCH`, and `DELETE` endpoint requests:

```ts
import { useMutation } from '@pinia/colada'
import { mutationOptions } from '#endpoints/colada'

const createPayment = useMutation(
  mutationOptions(
    $endpoint('/api/payments', {
      method: 'post',
      body: { amount: 1000 },
    }),
  ),
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

Use the `key` returned by `queryOptions()` with the Colada query cache:

```ts
import { useQueryCache } from '@pinia/colada'
import { queryOptions } from '#endpoints/colada'

const queryCache = useQueryCache()
const usersRequest = $endpoint('/api/users', { method: 'get' })

await queryCache.invalidateQueries({
  key: queryOptions(usersRequest).key,
})
```

## Cursor pagination

Declare the item schema once in the server contract. Nuxt Endpoints generates
the optional `cursor` and `limit` query, the typed page response, runtime
validation, and OpenAPI from it:

```ts
export default defineRouteHandler({
  pagination: {
    kind: 'cursor',
    item: Article,
  },
  handler: ({ validated }) => {
    return listArticles(validated.query)
    // { items: Article[], nextCursor?: string }
  },
})
```

Pass the resulting request to Pinia Colada without wiring `pageParam` by hand:

```ts
import { useInfiniteQuery } from '@pinia/colada'
import { infiniteQueryOptions } from '#endpoints/colada'

const articles = useInfiniteQuery(
  infiniteQueryOptions(
    $endpoint('/api/articles', {
      method: 'get',
      query: { limit: 20 },
    }),
  ),
)
```

The default fields are `cursor`, `limit`, `items`, and `nextCursor`. The limit
defaults to 20 and is bounded at 100. `infiniteQueryOptions()` only accepts a
GET request whose server contract declares pagination.

Pagination owns these query fields and response status 200. Do not repeat them
in `validate`; duplicate declarations fail TypeScript and Nuxt build checks.
Additional filters and other response statuses remain ordinary `validate`
entries.

A non-200 page is not cached as page data. It rejects with a typed
`EndpointPaginationError`; its optional `result` retains the endpoint's
status-discriminated response union. `result` is undefined when the request
failed before receiving an HTTP response:

```ts
const failure = articles.error.value?.result

if (failure?.status === 429) {
  // failure.body is the route's declared 429 body
}
```

## SSR

With `@pinia/colada-nuxt`, queries created during component setup are automatically prefetched during SSR and hydrated in the browser:

```vue
<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { queryOptions } from '#endpoints/colada'

const user = useQuery(
  queryOptions(
    $endpoint('/api/users/:id', {
      method: 'get',
      params: { id: '123' },
    }),
  ),
)
</script>
```

Construct requests inside component setup, a Nuxt plugin, or route middleware—not at module scope—so each server request captures its own credentials. Configure cache defaults and plugins through Pinia Colada's standard `colada.options.ts` file.
