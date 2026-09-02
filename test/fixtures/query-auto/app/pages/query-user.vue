<script setup lang="ts">
import { useQuery } from '@pinia/colada'

const query = useQuery(
  $endpoint('/api/users/:id', { method: 'get', params: { id: '123' } }).queryOptions(),
)
</script>

<template>
  <div>query-user: {{ query.data.value?.body.name }}</div>
</template>
