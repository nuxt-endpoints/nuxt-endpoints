import { toEndpointRouteConfigEntries, toImportPath } from './shared'
import type { EndpointClientCodegenOptions, EndpointRouteHandler, ResolvePath } from './types'

// Pure builder: returns the `endpoints.ts` runtime client content. Writing it
// to disk is module.ts's responsibility (via its `writeGenerated` helper), so
// this generator can be unit tested without touching the filesystem.
export function generateEndpointClient(
  resolve: ResolvePath,
  handlers: readonly EndpointRouteHandler[],
  options: EndpointClientCodegenOptions,
): string {
  const routes = toEndpointRouteConfigEntries(handlers)
  const clientFeatures = { raw: options.client.raw }
  const clientRuntimeImportPath = toImportPath(resolve('./runtime/client'))
  // Direct `$endpoint` awaits mirror `$fetch`; its Pinia Colada option methods and
  // `useEndpoint` use `captureFetcher` to forward SSR request headers.
  const clientOptions = `, { features: ${JSON.stringify(clientFeatures)}, captureFetcher }`
  const asyncDataClientOptions = `, { features: ${JSON.stringify(clientFeatures)}, captureFetcher }`
  const asyncDataRuntime = '__useEndpointAsyncData'
  return `
import { createUseAsyncData } from '#app/composables/asyncData'
import { navigateTo, useRequestEvent, useRequestFetch, useState } from 'nuxt/app'
import { computed, ref } from 'vue'
import { createEndpointClient, createUseEndpoint, createUseEndpointForm } from '${clientRuntimeImportPath}'

import type { EndpointFetcherRuntime, UseEndpointClientRuntimeValue } from '${clientRuntimeImportPath}'
import type { $EndpointClient, $UseEndpoint, $UseEndpointForm } from '#endpoints'

const routes = ${JSON.stringify(routes, null, 2)} as const
export const __useEndpointAsyncData = createUseAsyncData()

// Forwards the SSR request's cookies and headers to the internal route, the
// way \`useFetch\` does for relative paths. Outside a Nuxt request context
// there is nothing to forward, so the client falls back to plain \`$fetch\` —
// \`useAsyncData\` raises its own error for a genuinely misplaced call.
const captureFetcher = () => {
  try {
    return useRequestFetch() as unknown as EndpointFetcherRuntime
  } catch {
    return undefined
  }
}

// The reactivity and navigation \`useEndpointForm\` needs, injected the way
// \`captureFetcher\` is so the client runtime imports nothing from Vue or Nuxt.
const formBindings = { ref, computed, useState, useRequestEvent, navigateTo }

export const $endpoint = createEndpointClient(routes${clientOptions}) as unknown as $EndpointClient
export const useEndpoint = createUseEndpoint(routes, ${asyncDataRuntime}${asyncDataClientOptions}) as unknown as $UseEndpoint
export const useEndpointForm = createUseEndpointForm(routes, { ...formBindings, useEndpoint: useEndpoint as unknown as UseEndpointClientRuntimeValue }, { captureFetcher }) as unknown as $UseEndpointForm
`.trimStart()
}
