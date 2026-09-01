<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { onServerPrefetch } from 'vue'

const query = useQuery($endpoint('/api/whoami', { method: 'get' }).queryOptions())
onServerPrefetch(() => query.suspense())
</script>

<template>
  <div>query-whoami: {{ query.data.value?.body.user }}</div>
</template>
