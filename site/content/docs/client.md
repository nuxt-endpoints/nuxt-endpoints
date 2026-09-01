---
title: Generated Client
description: Call server routes by typed path, method, or operation name.
---

Nuxt Endpoints generates `$endpoint` and `#endpoints` types from discovered endpoint definitions.

## Client calls

The primary call uses the route path and HTTP method. It creates a lazy request object whose awaited value is the endpoint's declared status union. Request options are inferred from the endpoint request schemas, and response bodies follow the JSON wire representation of the endpoint response schema.

Response validation uses the schema output on the server before HTTP serialization. The client sees the parsed JSON value, so a schema output such as `Date` is typed as `string` on `$endpoint`, `useEndpoint`, and Vue Query clients.

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
optional [Vue Query](/docs/tanstack-query) adapter when the request needs
shared server-state caching, retries, invalidation, or optimistic updates.

## Request forwarding during SSR

Each client mirrors the Nuxt primitive it stands in for, and Nuxt treats those
two primitives differently:

| Client                                      | Incoming cookies and headers during SSR | Mirrors    |
| ------------------------------------------- | --------------------------------------- | ---------- |
| `useEndpoint`                               | Forwarded                               | `useFetch` |
| [Vue Query](/docs/tanstack-query) factories | Forwarded                               | `useFetch` |
| `$endpoint`                                 | Not forwarded                           | `$fetch`   |

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

Add `operation` only when you also want a named call target.

```ts
export default defineRouteHandler({
  operation: 'getUser',
  params: UserParams,
  validate: { response: { 200: User } },
  handler: (event) => findUser(event.validated.params.id),
})

await $endpoint('getUser', { params: { id: '123' } })
await $endpoint.getUser({ params: { id: '123' } })
```

The async-data composables also accept operation names. Path calls use `method`; operation calls
already know their method.

```ts
await useEndpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
})

await useEndpoint('getUser', {
  params: { id: '123' },
})
```

See [Responses](/docs/responses) for status-aware typed results and raw Web Response calls.

## Generated helper types

Import helper types from `#endpoints` when shared app code needs to reference an operation, request call, or response body without manually duplicating types.

```ts
import type {
  $EndpointCall,
  $EndpointPathCall,
  $EndpointPathResponse,
  $EndpointRawResponse,
  $EndpointResult,
  $EndpointResponse,
  $UseEndpointResultPathCall,
  EndpointMethod,
  EndpointOperation,
  EndpointPath,
} from '#endpoints'

type Path = EndpointPath
type GetUserMethod = EndpointMethod<'/api/users/:id'>
type User = $EndpointPathResponse<'/api/users/:id', 'get'>
type UserCall = $EndpointPathCall<'/api/users/:id', 'get'>

// Operation helpers are available when the route declares operation: 'getUser'.
type Operation = EndpointOperation
type UserOperationResponse = $EndpointResponse<'getUser'>
type UserOperationCall = $EndpointCall<'getUser'>
type UserOperationResult = $EndpointResult<'getUser'>
type UserOperationRawResponse = $EndpointRawResponse<'getUser'>
type UserResultState = $UseEndpointResultPathCall<'/api/users/:id', 'get'>
```
