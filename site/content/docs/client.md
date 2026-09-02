---
title: Generated Client
description: Call server routes by typed path and method.
---

Nuxt Endpoints generates `$endpoint` and `#endpoints` types from discovered endpoint definitions.

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

The same request object exposes `.queryOptions()` for `GET`/`HEAD` and
`.mutationOptions()` for unsafe methods. Pass those ordinary options to the
[Pinia Colada](/docs/pinia-colada) when the request needs shared server-state
caching, invalidation, or optimistic updates.

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
