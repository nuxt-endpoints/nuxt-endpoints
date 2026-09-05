<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { queryOptions } from '#endpoints/colada'

const query = useQuery(queryOptions($endpoint('/api/whoami', { method: 'get' })))
</script>

<template>
  <div>query-whoami: {{ query.data.value?.body.user }}</div>
</template>
