<script setup lang="ts">
const route = useRoute()
const q = typeof route.query.q === 'string' ? route.query.q : ''
const form = useEndpointForm('/api/pe/search', {
  method: 'get',
  query: { q },
})

const items = computed(() =>
  form.result.value?.status === 200 ? form.result.value.body.items : [],
)
</script>

<template>
  <div class="ne-pe-page">
    <h1 class="title">GET search form</h1>

    <form v-bind="form.attrs" class="form" @submit="form.enhance">
      <label class="label">
        Search
        <input v-bind="form.fields.q" class="input" type="search" />
      </label>
      <button type="submit" class="button" :disabled="form.pending.value">Search</button>
    </form>

    <p data-testid="search-status">{{ form.status.value }}</p>
    <ul data-testid="search-results" class="list">
      <li v-for="item in items" :key="item" class="item">{{ item }}</li>
    </ul>
  </div>
</template>
