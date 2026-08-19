<script setup lang="ts">
// URL-encoded rather than multipart: a multipart body needs a Content-Type
// with a runtime-generated boundary, which a server-side call to a local route
// never gets because Nuxt dispatches into the handler without building a
// Request. The multipart path is covered by a real HTTP request in the
// integration tests instead.
const body = new URLSearchParams({ name: 'Encoded' })

const result = await $endpoint('/api/upload', {
  method: 'post',
  mediaType: 'application/x-www-form-urlencoded',
  body,
})
</script>

<template>
  <div>upload: {{ result.name }} via {{ result.bodyMediaType }}</div>
</template>
