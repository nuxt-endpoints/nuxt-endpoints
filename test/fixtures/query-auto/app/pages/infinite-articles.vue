<script setup lang="ts">
import { computed } from 'vue'
import { useInfiniteQuery } from '@pinia/colada'
import { infiniteQueryOptions } from '#endpoints/colada'

const articles = useInfiniteQuery(
  infiniteQueryOptions($endpoint('/api/articles', { method: 'get', query: { limit: 2 } })),
)

const articleTitles = computed(
  () =>
    articles.data.value?.pages
      .flatMap((page) => page.items.map((article) => article.title))
      .join(',') ?? '',
)
</script>

<template>
  <div>
    <div data-testid="article-titles">infinite-articles: {{ articleTitles }}</div>
    <button
      type="button"
      :disabled="!articles.hasNextPage.value || articles.isLoading.value"
      @click="articles.loadNextPage()"
    >
      Load next page
    </button>
  </div>
</template>
