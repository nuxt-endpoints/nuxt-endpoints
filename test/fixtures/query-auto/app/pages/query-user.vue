<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { queryOptions } from '#endpoints/colada'

const query = useQuery(queryOptions($endpoint.getUser({ params: { id: '123' } })))
</script>

<template>
  <div>query-user: {{ query.data.value?.body.name }}</div>
</template>
