<script setup lang="ts">
import { useMutation } from '@pinia/colada'

const request = $endpoint('/api/idempotent', { method: 'post', body: { amount: 25 } })
const options = request.mutationOptions()
const mutation = useMutation(options)

const first = await mutation.mutateAsync()
const second = await mutation.mutateAsync()

const describe = (result: typeof first) =>
  result.status === 201
    ? `201:${result.body.id}:${result.body.amount}`
    : `${result.status}:unexpected`

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
