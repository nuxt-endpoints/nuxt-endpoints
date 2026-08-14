<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { onServerPrefetch } from 'vue'
import { endpointQueryOptions } from '#endpoints/query'

const query = useQuery(endpointQueryOptions.whoami())
onServerPrefetch(() => query.suspense())
</script>

<template>
  <div>query-whoami: {{ query.data.value?.user }}</div>
</template>
