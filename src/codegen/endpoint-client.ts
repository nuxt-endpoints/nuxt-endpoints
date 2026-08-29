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
  const useEndpointResultRuntimeImport = options.client.result ? ', createUseEndpointResult' : ''
  const useEndpointResultTypeImport = options.client.result ? ', $UseEndpointResult' : ''
  const clientFeatures = {
    result: options.client.result,
    raw: options.client.raw,
  }
  const clientRuntimeImportPath = toImportPath(resolve('./runtime/client'))
  // `$endpoint` mirrors `$fetch`, so it gets features only. The `useEndpoint`
  // family mirrors `useFetch`, which swaps in `useRequestFetch()` for relative
  // paths during SSR — hence the extra `captureFetcher`.
  const clientOptions = `, { features: ${JSON.stringify(clientFeatures)} }`
  const asyncDataClientOptions = `, { features: ${JSON.stringify(clientFeatures)}, captureFetcher }`
  const asyncDataRuntime = '__useEndpointAsyncData'
  const useEndpointResultExport = options.client.result
    ? `\nexport const useEndpointResult = createUseEndpointResult(routes, ${asyncDataRuntime}${asyncDataClientOptions}) as unknown as $UseEndpointResult`
    : ''

  return `
import { createUseAsyncData } from '#app/composables/asyncData'
import { useRequestFetch } from 'nuxt/app'
import { createEndpointClient, createUseEndpoint${useEndpointResultRuntimeImport} } from '${clientRuntimeImportPath}'

import type { EndpointFetcherRuntime } from '${clientRuntimeImportPath}'
import type { $EndpointClient, $UseEndpoint${useEndpointResultTypeImport} } from '#endpoints'

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

export const $endpoint = createEndpointClient(routes${clientOptions}) as unknown as $EndpointClient
export const useEndpoint = createUseEndpoint(routes, ${asyncDataRuntime}${asyncDataClientOptions}) as unknown as $UseEndpoint${useEndpointResultExport}
`.trimStart()
}
