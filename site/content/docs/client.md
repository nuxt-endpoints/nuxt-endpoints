---
title: Calling endpoints
description: Use Nuxt 4.6 typed fetch to read success and error bodies, or call the generated endpoint client.
---

Call a JSON endpoint with Nuxt’s `$fetch` or `useFetch`. The module also generates `$endpoint` and `useEndpoint` for applications using its request objects.

## Nuxt fetch types

On Nuxt 4.6, enable `routeTypedFetch` and opt into `client.nativeFetch` to
use a route's endpoint contract with Nuxt's auto-imported `$fetch` and
`useFetch` (also available from `#imports`).

```ts
export default defineNuxtConfig({
  modules: ['nuxt-endpoints'],
  experimental: { routeTypedFetch: true },
  endpoints: { client: { nativeFetch: true } },
})
```

Nuxt infers the body, query, and successful response for each declared method,
including methods grouped in one route file. For JSON endpoints the module
also types request headers and links HTTP statuses to their parsed bodies.
Dynamic URLs such as `/api/users/${id}` use Nuxt's route matching rules. When
TypeScript can resolve the URL and method to a single endpoint contract, a
raw call opts into receiving HTTP errors as responses:

```ts
const response = await $fetch.raw('/api/bookings', {
  method: 'POST',
  body: { slotId: 'slot-42' },
  ignoreResponseError: true,
})

if (response.status === 409) {
  console.log(response._data?.reason)
}
```

If `/api/users/me` and `/api/users/:id` both exist, a URL built from a
string ID could reach either route. Use the auto-imported `buildPath` to
select the dynamic contract and keep status-aware types:

```ts
const { data, error } = await useFetch(buildPath('/api/users/:id', { params: { id } }))
```

`buildPath` encodes the parameters and returns a relative path you can also
pass to `$fetch` or `$fetch.raw`. If `id` is `'me'`, it throws before the
request. The check covers every registered method because the same path can
be reused for different requests. To call the fixed route, pass
`'/api/users/me'` directly.

`useFetch` keeps the successful body in `data`. Branch on `error.value.status`
to narrow the error body:

```ts
const { error } = await useFetch('/api/bookings', {
  method: 'POST',
  body: { slotId: 'slot-42' },
})

if (error.value?.status === 409) {
  console.log(error.value.data?.reason)
}
```

Nuxt 4.6 permits omitting the whole query option. A supplied query is checked against its schema, and the server validates each incoming request. With `ignoreResponseError: true`, check the HTTP status before reading fields from `response._data`: an undeclared status can carry an unknown body.

A single `onResponse` callback also narrows the response body by status.
Undeclared statuses have an unknown body. `error.value.data` stays unknown
for status `500` because Nuxt can assign that status to failures without an
HTTP response. Calls with custom parsing, a custom base URL, or `useFetch`
transforms use Nuxt's original overloads.

## Client calls

The primary call uses the route path and HTTP method. It creates a lazy request object whose awaited value is the endpoint's declared status union. Request options are inferred from the endpoint request schemas, and response bodies follow the JSON wire representation of the endpoint response schema.

Response validation uses the schema output on the server before HTTP serialization. The client sees the parsed JSON value, so a schema output such as `Date` is typed as `string` on `$endpoint`, `useEndpoint`, and Pinia Colada clients.

```vue
<script setup lang="ts">
const result = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
  query: { includePosts: true },
})

if (result.status === 200) {
  result.body.id.toFixed()
  result.body.name.toUpperCase()
}
</script>
```

When a route declares a unique `name`, the generated client also exposes a
typed alias for that same path-and-method request:

```ts
const result = await $endpoint.getUser({
  params: { id: '123' },
  query: { includePosts: true },
})
```

The name does not create another operation or flatten HTTP input. `params`,
`query`, `headers`, and `body` keep the same types as the canonical path call.

Use `useEndpoint` when the same typed call should be managed as Nuxt async data.
It forwards Nuxt async-data options such as `key`, `lazy`, `server`, `watch`, and
`default`, while keeping endpoint `params`, `query`, `headers`, and `body` typed.

```vue
<script setup lang="ts">
const {
  data: result,
  pending,
  error,
  refresh,
} = await useEndpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
  key: 'user:123',
})

if (result.value?.status === 200) {
  result.value.body.name.toUpperCase()
}
</script>
```

Pass the same request object to `queryOptions()` for `GET`/`HEAD`,
`mutationOptions()` for unsafe methods, or `infiniteQueryOptions()` for a
cursor-pagination contract. These typed adapters produce ordinary
[Pinia Colada](/docs/pinia-colada) options when the request needs shared
server-state caching, invalidation, pagination, or optimistic updates.

## Request forwarding during SSR

Each client mirrors the Nuxt primitive it stands in for, and Nuxt treats those
two primitives differently:

| Client                                             | Incoming cookies and headers during SSR | Mirrors    |
| -------------------------------------------------- | --------------------------------------- | ---------- |
| `useEndpoint`                                      | Forwarded                               | `useFetch` |
| [Pinia Colada](/docs/pinia-colada) request options | Forwarded                               | `useFetch` |
| `$endpoint`                                        | Not forwarded                           | `$fetch`   |

`useFetch` swaps plain `$fetch` for `useRequestFetch()` when the path is
relative, so a session cookie reaches the internal route. `useEndpoint`
captures the same request-aware fetcher per call, so concurrent SSR requests
never share one another's credentials.

`$fetch` does not forward, and neither does `$endpoint`. Calling a
cookie-authenticated endpoint through `$endpoint` during SSR reaches the route
unauthenticated, exactly as the same call through `$fetch` would. Reach for
`useEndpoint` in that case:

```vue
<script setup lang="ts">
// Forwards the session cookie during SSR.
const { data: user } = await useEndpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
})
</script>
```

None of this applies on the client, where there is no incoming request to
forward and every client issues the same browser `fetch`.

See [Responses](/docs/responses) for status-aware typed results and raw Web Response calls.

## Generated helper types

Import helper types from `#endpoints` when shared app code needs to reference a path, request call, or response without duplicating types.

```ts
import type {
  $EndpointPathCall,
  $EndpointPathResponse,
  $EndpointPathRawResponse,
  $UseEndpointPathCall,
  EndpointMethod,
  EndpointPath,
} from '#endpoints'

type Path = EndpointPath
type GetUserMethod = EndpointMethod<'/api/users/:id'>
type User = $EndpointPathResponse<'/api/users/:id', 'get'>
type UserCall = $EndpointPathCall<'/api/users/:id', 'get'>
type UserRawResponse = $EndpointPathRawResponse<'/api/users/:id', 'get'>
type UserState = $UseEndpointPathCall<'/api/users/:id', 'get'>
```
