<script setup lang="ts">
import { useInfiniteQuery } from '@pinia/colada'
import { infiniteQueryOptions } from '#endpoints/colada'

const articles = useInfiniteQuery(
  infiniteQueryOptions($endpoint('/api/articles', { method: 'get', query: { limit: 2 } })),
)
</script>

<template>
  <div>
    infinite-articles:
    {{ articles.data.value?.pages[0]?.items.map((article) => article.title).join(',') }}
  </div>
</template>
