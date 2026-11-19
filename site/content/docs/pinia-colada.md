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

On Nuxt 4.6 with [native fetch types](/docs/client#nuxt-fetch-types) enabled,
pass a same-origin URL for a JSON `GET` endpoint. The adapter builds the cache
key from the URL and query and forwards incoming request headers during SSR.

```ts
import { useQuery } from '@pinia/colada'
import { queryOptions } from '#endpoints/colada'

const user = useQuery(
  queryOptions(`/api/users/${id}`, {
    query: { includePosts: true },
  }),
)

if (user.data.value?.status === 404) {
  console.log(user.data.value.body.reason)
}
```

`queryOptions()` also accepts `GET` and `HEAD` request objects from `$endpoint()`:

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

With native fetch types enabled, pass the URL and method directly. Create one
options object per logical submission. Reusing it for a retry preserves the
generated idempotency key on routes that require one.

```ts
const createPayment = useMutation(
  mutationOptions('/api/payments', { method: 'POST', body: { amount: 1000 } }),
)
```

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

For a route with required idempotency, one request object represents one
logical mutation. Its automatically generated key remains fixed whenever that
object is executed again. Create a new request object for a separate logical
action. Non-idempotent routes do not generate a key.

When each `mutate(...)` call supplies different variables, create the endpoint
request inside a normal Colada mutation function. For a required idempotent
route, each invocation then receives a new key:

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
export default defineEndpoint({
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

Pagination declares `cursor`, `limit`, and the status 200 page body. Put
additional filters in `validate.query` and other status codes in `responses`.

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

For a GET endpoint with a cursor pagination contract, the URL overload also
infers the item and error types. The adapter supplies the cursor on each page
request and forwards Colada's abort signal.

```ts
import { useInfiniteQuery } from '@pinia/colada'
import { infiniteQueryOptions } from '#endpoints/colada'

const articles = useInfiniteQuery(infiniteQueryOptions('/api/articles', { query: { limit: 20 } }))
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
