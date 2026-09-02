<script setup lang="ts">
import { useQuery } from '@pinia/colada'

const query = useQuery($endpoint('/api/whoami', { method: 'get' }).queryOptions())
</script>

<template>
  <div>query-whoami: {{ query.data.value?.body.user }}</div>
</template>
