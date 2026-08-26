---
title: Generated Client
description: Call server routes by typed path, method, or operation name.
---

Nuxt Endpoints generates `$endpoint` and `#endpoints` types from discovered endpoint definitions.

## Client calls

The primary call uses the route path and HTTP method. The default call returns the success body. Request options are inferred from the endpoint request schemas, and the returned body follows the JSON wire representation of the endpoint response schema.

Response validation uses the schema output on the server before HTTP serialization. The client sees the parsed JSON value, so a schema output such as `Date` is typed as `string` on `$endpoint`, `useEndpoint`, and Vue Query clients.

```vue
<script setup lang="ts">
const user = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
  query: { includePosts: true },
})

user.id.toFixed()
user.name.toUpperCase()
</script>
```

Use `useEndpoint` when the same typed call should be managed as Nuxt async data.
It forwards Nuxt async-data options such as `key`, `lazy`, `server`, `watch`, and
`default`, while keeping endpoint `params`, `query`, `headers`, and `body` typed.

```vue
<script setup lang="ts">
const {
  data: user,
  pending,
  error,
  refresh,
} = await useEndpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
  key: 'user:123',
})

user.value?.name.toUpperCase()
</script>
```

Use the optional [Vue Query](/docs/tanstack-query) adapter when the same
endpoint needs shared server-state caching, retries, invalidation, optimistic
updates, prefetching, or infinite-query state.

Add `operation` only when you also want a named call target.

```ts
export const endpoint = defineEndpoint({
  operation: 'getUser',
  params: UserParams,
  responses: { 200: User },
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
