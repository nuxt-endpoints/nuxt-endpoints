<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { onServerPrefetch } from 'vue'
import { endpointQueryOptions } from '#endpoints/query'

const query = useQuery(endpointQueryOptions.getUser({ params: { id: '123' } }))
onServerPrefetch(() => query.suspense())
</script>

<template>
  <div>query-user: {{ query.data.value?.name }}</div>
</template>
