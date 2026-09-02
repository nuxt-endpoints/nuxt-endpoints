<script setup lang="ts">
import { useMutation } from '@pinia/colada'

// Drives `.mutationOptions()` through the real Pinia Colada `useMutation`
// rather than calling the returned `mutation` function directly, so the
// `{ key, mutation }` shape is proven against the actual library.
//
// One request object is one logical mutation, so both executions send the same
// generated Idempotency-Key. `/api/idempotent` increments `id` only when the
// handler really runs, which makes a server-side replay observable as an
// unchanged id instead of having to inspect the outgoing header.
const request = $endpoint('/api/idempotent', { method: 'post', body: { amount: 25 } })
const options = request.mutationOptions()
const mutation = useMutation(options)

const first = await mutation.mutateAsync()
const second = await mutation.mutateAsync()

const describe = (result: typeof first) =>
  result.status === 201
    ? `201:${result.body.id}:${result.body.amount}`
    : `${result.status}:unexpected`

// Rendered without quotes so the assertion does not depend on HTML escaping.
const keyLabel = options.key.slice(0, 4).join(' ')
</script>

<template>
  <div>
    <div>mutation-first: {{ describe(first) }}</div>
    <div>mutation-second: {{ describe(second) }}</div>
    <div>mutation-key: {{ keyLabel }}</div>
    <div>mutation-state: {{ mutation.status.value }}</div>
  </div>
</template>
