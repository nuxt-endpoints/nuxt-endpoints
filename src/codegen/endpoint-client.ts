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
  const clientOptions = `, { features: ${JSON.stringify(clientFeatures)} }`
  const asyncDataClientOptions = `, { features: ${JSON.stringify(clientFeatures)} }`
  const asyncDataRuntime = '__useEndpointAsyncData'
  const useEndpointResultExport = options.client.result
    ? `\nexport const useEndpointResult = createUseEndpointResult(routes, ${asyncDataRuntime}${asyncDataClientOptions}) as unknown as $UseEndpointResult`
    : ''

  return `
import { createUseAsyncData } from '#app/composables/asyncData'
import { createEndpointClient, createUseEndpoint${useEndpointResultRuntimeImport} } from '${toImportPath(resolve('./runtime/client'))}'

import type { $EndpointClient, $UseEndpoint${useEndpointResultTypeImport} } from '#endpoints'

const routes = ${JSON.stringify(routes, null, 2)} as const
export const __useEndpointAsyncData = createUseAsyncData()

export const $endpoint = createEndpointClient(routes${clientOptions}) as unknown as $EndpointClient
export const useEndpoint = createUseEndpoint(routes, ${asyncDataRuntime}${asyncDataClientOptions}) as unknown as $UseEndpoint${useEndpointResultExport}
`.trimStart()
}
