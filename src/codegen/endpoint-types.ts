import { toImportPath } from './shared'
import type { EndpointClientCodegenOptions, EndpointRouteHandler, ResolvePath } from './types'

export function buildEndpointRouteEntryUnion(
  handlers: readonly EndpointRouteHandler[],
  serverRouteConfigPath?: string,
): string {
  return handlers.length
    ? handlers
        .map((handler) => {
          const definitionAccessor = `TypedFetchMetadataField<ServerRoutes, '${handler.route}', 'contract', '${handler.method}'>`
          const routeDefinition = `typeof import('${toImportPath(handler.handler)}').default['~routeDef']`
          const handlerReturnAccessor = `EndpointHandlerReturnFromRoute<${routeDefinition}, '${handler.method}'>`
          const serverResponses = serverRouteConfigPath
            ? `, serverResponses: ServerRouteResponsesFor<typeof import('${toImportPath(serverRouteConfigPath)}').default, '${handler.route}', '${handler.method}'>`
            : ''
          return `  | { path: '${handler.route}', method: '${handler.method}', definition: ${definitionAccessor}, handlerReturn: ${handlerReturnAccessor}${serverResponses} }`
        })
        .join('\n')
    : '  | never'
}

export function generateEndpointTypes(
  resolve: ResolvePath,
  handlers: readonly EndpointRouteHandler[],
  options: EndpointClientCodegenOptions,
): string {
  const endpointUnion = buildEndpointRouteEntryUnion(handlers, options.serverRouteConfigPath)
  const clientFeatures = `{ raw: ${options.client.raw ? 'true' : 'false'} }`
  const rawResponseType = options.client.raw
    ? "\nexport type $EndpointPathRawResponse<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = Awaited<ReturnType<$EndpointPathCall<PATH, METHOD>['raw']>>"
    : '\nexport type $EndpointPathRawResponse<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = never'
  const serverRouteConfigImport = options.serverRouteConfigPath
    ? `\nimport type { ServerRouteResponsesFor } from '${toImportPath(resolve('./runtime'))}'`
    : ''

  return `
import type { EndpointClient, EndpointHandlerReturnFromRoute, EndpointPathCall, UseEndpointClient, UseEndpointClientMethod } from '${toImportPath(resolve('./runtime'))}'
import type { ServerRoutes } from '@nuxt/schema'
import type { TypedFetchMetadataField } from 'nuxt/app'
${serverRouteConfigImport}

type EndpointRouteEntry =
${endpointUnion}

type EndpointClientFeatures = ${clientFeatures}
type EndpointRouteForPath<PATH extends EndpointPath> = Extract<EndpointRouteEntry, { path: PATH }>
type EndpointRouteForPathMethod<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = Extract<EndpointRouteEntry, { path: PATH, method: METHOD }>

export type $EndpointClient = EndpointClient<EndpointRouteEntry, EndpointClientFeatures>
export type EndpointPath = EndpointRouteEntry['path']
export type EndpointMethod<PATH extends EndpointPath> = EndpointRouteForPath<PATH>['method']
export type $EndpointPathResponse<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = Awaited<$EndpointPathCall<PATH, METHOD>>
export type $EndpointPathCall<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = EndpointPathCall<EndpointRouteEntry, PATH, METHOD, EndpointClientFeatures>
export type $UseEndpoint = UseEndpointClient<EndpointRouteEntry, EndpointClientFeatures>
export type $UseEndpointPathCall<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = ReturnType<UseEndpointClientMethod<EndpointRouteForPathMethod<PATH, METHOD>, EndpointClientFeatures>>
${rawResponseType}
export type { EndpointClient, EndpointPathCall, UseEndpointClient, UseEndpointClientMethod }
`.trimStart()
}
