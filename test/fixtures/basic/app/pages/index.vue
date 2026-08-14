<script setup lang="ts">
const { data: user } = await useEndpoint('getUser', {
  params: { id: '123' },
  key: 'fixture-user',
})
</script>

<template>
  <div>nuxt-endpoints fixture: {{ user?.name }}</div>
</template>
