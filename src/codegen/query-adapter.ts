import { buildEndpointRouteEntryUnion } from './endpoint-types'
import { toEndpointRouteConfigEntries, toImportPath } from './shared'
import type { EndpointRouteHandler, ResolvePath } from './types'

// Pure builder: returns the `types/endpoints-query.d.ts` content.
export function generateEndpointQueryTypes(
  resolve: ResolvePath,
  handlers: readonly EndpointRouteHandler[],
): string {
  const endpointUnion = buildEndpointRouteEntryUnion(handlers)

  return `
import type { EndpointInfiniteQueryOptionsClient, EndpointMutationOptionsClient, EndpointQueryOptionsClient } from '${toImportPath(resolve('./runtime/tanstack-query'))}'

type EndpointRouteEntry =
${endpointUnion}

export type $EndpointQueryOptions = EndpointQueryOptionsClient<EndpointRouteEntry>
export type $EndpointMutationOptions = EndpointMutationOptionsClient<EndpointRouteEntry>
export type $EndpointInfiniteQueryOptions = EndpointInfiniteQueryOptionsClient<EndpointRouteEntry>
`.trimStart()
}

// Pure builder: returns the `endpoints-query.ts` runtime content.
export function generateEndpointQueryClient(
  resolve: ResolvePath,
  queryTypeFile: string,
  handlers: readonly EndpointRouteHandler[],
): string {
  const routes = toEndpointRouteConfigEntries(handlers)
  const queryRuntimeImportPath = toImportPath(resolve('./runtime/tanstack-query'))
  const queryTypeImportPath = toImportPath(queryTypeFile.replace(/\.d\.ts$/, ''))

  return `
import { useRequestFetch } from 'nuxt/app'
import { createEndpointInfiniteQueryOptions, createEndpointMutationOptions, createEndpointQueryOptions } from '${queryRuntimeImportPath}'

import type { EndpointFetcherRuntime } from '${queryRuntimeImportPath}'
import type { $EndpointInfiniteQueryOptions, $EndpointMutationOptions, $EndpointQueryOptions } from '${queryTypeImportPath}'

const routes = ${JSON.stringify(routes, null, 2)} as const

const captureFetcher = () => {
  try {
    return useRequestFetch() as unknown as EndpointFetcherRuntime
  } catch (error) {
    if (import.meta.server) {
      throw new Error(
        '[nuxt-endpoints] endpointQueryOptions/endpointMutationOptions/endpointInfiniteQueryOptions factories must be called while Nuxt context is available (component setup, plugins, or route middleware), so the request-aware fetcher can be captured for SSR.',
        { cause: error },
      )
    }
    return undefined
  }
}

export const endpointQueryOptions = createEndpointQueryOptions(routes, { captureFetcher }) as unknown as $EndpointQueryOptions
export const endpointMutationOptions = createEndpointMutationOptions(routes, { captureFetcher }) as unknown as $EndpointMutationOptions
export const endpointInfiniteQueryOptions = createEndpointInfiniteQueryOptions(routes, { captureFetcher }) as unknown as $EndpointInfiniteQueryOptions
`.trimStart()
}

// Pure builder: returns the auto-setup Vue Query plugin content
// (`endpoints-query-plugin.ts`), registered through Nuxt's plugin template
// pipeline rather than written directly (see module.ts for why).
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
