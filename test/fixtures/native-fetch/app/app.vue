<script setup lang="ts">
import { $fetch as nuxtFetch } from '#build/fetch'
import { useFetch as nuxtUseFetch } from 'nuxt/app'
import { $fetch, useFetch } from '#imports'

const { data, refresh: refreshBooking } = await useFetch('/api/bookings')
const userPath = buildPath('/api/users/:id', { params: { id: '42' } })
const { error, refresh: refreshMissingUser } = await useFetch(userPath)

async function observeFetch() {
  const raw = await $fetch.raw(userPath, { ignoreResponseError: true })
  let rejected = false
  try {
    await $fetch(userPath)
  } catch {
    rejected = true
  }
  let collisionRejected = false
  try {
    buildPath('/api/users/:id', { params: { id: 'me' } })
  } catch (error) {
    collisionRejected = error instanceof TypeError && error.message.includes('/api/users/me')
  }
  return {
    collisionRejected,
    sameFunctions: $fetch === nuxtFetch && useFetch === nuxtUseFetch,
    available: data.value?.available,
    error: error.value?.status === 404 && error.value.data?.reason,
    raw: raw.status === 404 && raw._data?.reason,
    rejected,
  }
}

const result = ref(await observeFetch())
const refreshed = ref(false)
async function refresh() {
  await Promise.all([refreshBooking(), refreshMissingUser()])
  result.value = await observeFetch()
  refreshed.value = true
}
</script>

<template>
  <main>
    <button @click="refresh">Refresh</button>
    <pre id="result" :data-refreshed="refreshed">{{ JSON.stringify(result) }}</pre>
  </main>
</template>
