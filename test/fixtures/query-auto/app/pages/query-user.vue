<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { onServerPrefetch } from 'vue'

const query = useQuery(
  $endpoint('/api/users/:id', { method: 'get', params: { id: '123' } }).queryOptions(),
)
onServerPrefetch(() => query.suspense())
</script>

<template>
  <div>query-user: {{ query.data.value?.body.name }}</div>
</template>
