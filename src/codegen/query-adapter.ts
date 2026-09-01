// Pure builder for the optional auto-setup Vue Query plugin.
export function generateEndpointQueryPlugin(staleTime: number): string {
  return `
import type { DehydratedState } from '@tanstack/vue-query'
import { QueryClient, VueQueryPlugin, dehydrate, hydrate } from '@tanstack/vue-query'
import { defineNuxtPlugin, useState } from 'nuxt/app'

export default defineNuxtPlugin((nuxtApp) => {
  const vueQueryState = useState<DehydratedState | null>('nuxt-endpoints-vue-query', () => null)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: ${staleTime},
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
`.trimStart()
}
