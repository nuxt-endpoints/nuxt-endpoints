<script setup lang="ts">
const formData = new FormData()
formData.append('name', 'Multipart')

const result = await $endpoint('/api/upload', {
  method: 'post',
  mediaType: 'multipart/form-data',
  body: formData,
})
</script>

<template>
  <div>upload: {{ result.name }} via {{ result.bodyMediaType }}</div>
</template>
