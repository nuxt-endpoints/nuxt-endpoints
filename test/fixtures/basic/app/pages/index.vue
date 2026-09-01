<script setup lang="ts">
const { data: user } = await useEndpoint('/api/users/:id', {
  method: 'get',
  params: { id: '123' },
  key: 'fixture-user',
})
</script>

<template>
  <div>nuxt-endpoints fixture: {{ user?.body.name }}</div>
</template>
