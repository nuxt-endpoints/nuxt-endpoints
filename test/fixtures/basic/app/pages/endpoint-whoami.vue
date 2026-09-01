<script setup lang="ts">
// `useEndpoint` stands in for `useFetch`, which swaps plain `$fetch` for
// `useRequestFetch()` on relative paths during SSR. This page fails without
// that capture: the internal route reads no session cookie and renders
// `anonymous`.
const { data } = await useEndpoint('/api/whoami', { method: 'get' })
</script>

<template>
  <div>endpoint-whoami: {{ data?.body.user }}</div>
</template>
