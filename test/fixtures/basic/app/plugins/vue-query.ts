import type { DehydratedState } from '@tanstack/vue-query'
import { QueryClient, VueQueryPlugin, dehydrate, hydrate } from '@tanstack/vue-query'
import { defineNuxtPlugin, useState } from 'nuxt/app'

export default defineNuxtPlugin((nuxtApp) => {
  const vueQueryState = useState<DehydratedState | null>('vue-query', () => null)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
      },
    },
  })
  nuxtApp.vueApp.use(VueQueryPlugin, { queryClient })

  if (import.meta.server) {
    nuxtApp.hooks.hook('app:rendered', () => {
      vueQueryState.value = dehydrate(queryClient)
      queryClient.clear()
    })
  }

  if (import.meta.client) {
    hydrate(queryClient, vueQueryState.value)
  }
})
