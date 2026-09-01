---
title: Responses
description: Work with status-aware endpoint results or raw Web Responses.
---

`$endpoint(...)` creates a lazy request object. No network request starts until the object is awaited, executed by `useEndpoint`, or passed to a query or mutation function.

## Status-aware result

Awaiting the request returns the endpoint's declared status union. The result contains `status`, `ok`, `body`, and `headers`, so both success and expected non-2xx responses are ordinary typed values.

All JSON response helpers expose wire types. For example, a server response schema whose output contains `Date` is validated as `Date` in the handler and received as `string` by the client.

```ts
const result = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '404' },
})

if (result.status === 404) {
  result.body.message
}
if (result.status === 200) {
  result.body.name
}
```

Transport failures still reject. A declared `404` does not: it resolves as the `404` member of the union.

The request object is memoized when awaited. Calling `then`, `catch`, or `finally` on the same object observes the same execution rather than sending duplicate requests.

## Nuxt async data

`useEndpoint` exposes the same status-aware result through Nuxt async data. Its serializable data omits native `Headers` and contains `{ status, ok, body }`.

```ts
const { data: result, error } = await useEndpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
})

if (result.value?.status === 404) {
  result.value.body.message
}
```

A declared `404` is stored in `data` and leaves `error` empty. This is why `useEndpoint` uses `useAsyncData` rather than trying to imitate `useFetch`'s error-response split.

## Raw Web Response

Use `.raw()` when code needs a native `Response`, such as for streaming, headers-first logic, or passing the response into lower-level utilities. For contracted JSON responses, the `json()` return type follows the serialized wire representation of the endpoint response schema.

```ts
const response = await $endpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
}).raw()

if (response.status === 200) {
  const body = await response.json()
  body.id
}
```

Set `endpoints.client.raw` to `false` to remove this advanced helper from the client surface. There is no `useEndpointRaw` because native `Response` and `Headers` values do not fit Nuxt async-data payloads cleanly.
