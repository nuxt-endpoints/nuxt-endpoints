import { toImportPath } from './shared'
import type { EndpointClientCodegenOptions, EndpointRouteHandler, ResolvePath } from './types'

function buildEndpointRouteEntry(
  handler: EndpointRouteHandler,
  serverRouteConfigPath?: string,
): string {
  const definitionAccessor = `TypedFetchMetadataField<ServerRoutes, '${handler.route}', 'contract', '${handler.method}'>`
  const routeDefinition = `typeof import('${toImportPath(handler.handler)}').default['~routeDef']`
  const effectiveDefinition = `ApplyEndpointPaginationFromRoute<${definitionAccessor}, ${routeDefinition}, '${handler.method}'>`
  const handlerReturnAccessor = `EndpointHandlerReturnFromRoute<${routeDefinition}, '${handler.method}'>`
  const serverResponses = serverRouteConfigPath
    ? `, serverResponses: ServerRouteResponsesFor<typeof import('${toImportPath(serverRouteConfigPath)}').default, '${handler.route}', '${handler.method}'>`
    : ''
  const name = handler.name ? `name: '${handler.name}', ` : ''
  return `{ ${name}path: '${handler.route}', method: '${handler.method}', definition: ${effectiveDefinition}, handlerReturn: ${handlerReturnAccessor}${serverResponses} }`
}

export function buildEndpointRouteEntryUnion(
  handlers: readonly EndpointRouteHandler[],
  serverRouteConfigPath?: string,
): string {
  return handlers.length
    ? handlers
        .map((handler) => `  | ${buildEndpointRouteEntry(handler, serverRouteConfigPath)}`)
        .join('\n')
    : '  | never'
}

export function buildEndpointRouteMap(
  handlers: readonly EndpointRouteHandler[],
  serverRouteConfigPath?: string,
): string {
  const routes = new Map<string, EndpointRouteHandler[]>()
  for (const handler of handlers) {
    const methods = routes.get(handler.route)
    if (methods) methods.push(handler)
    else routes.set(handler.route, [handler])
  }

  return routes.size
    ? [...routes]
        .map(
          ([route, methods]) =>
            `  '${route}': {\n${methods
              .map(
                (handler) =>
                  `    '${handler.method}': ${buildEndpointRouteEntry(handler, serverRouteConfigPath)}`,
              )
              .join('\n')}\n  }`,
        )
        .join('\n')
    : ''
}

export function generateEndpointTypes(
  resolve: ResolvePath,
  handlers: readonly EndpointRouteHandler[],
  options: EndpointClientCodegenOptions,
): string {
  const endpointMap = buildEndpointRouteMap(handlers, options.serverRouteConfigPath)
  const clientFeatures = `{ raw: ${options.client.raw ? 'true' : 'false'} }`
  const rawResponseType = options.client.raw
    ? "\nexport type $EndpointPathRawResponse<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = Awaited<ReturnType<$EndpointPathCall<PATH, METHOD>['raw']>>"
    : '\nexport type $EndpointPathRawResponse<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = never'
  const serverRouteConfigImport = options.serverRouteConfigPath
    ? `\nimport type { ServerRouteResponsesFor } from '${toImportPath(resolve('./runtime'))}'`
    : ''

  return `
import type { ApplyEndpointPaginationFromRoute, EndpointClient, EndpointHandlerReturnFromRoute, EndpointMappedClient, EndpointMappedPathCall, EndpointMappedUseClient, EndpointPathCall, EndpointRouteMapEntry, EndpointRouteMapValue, HttpMethod, UseEndpointClient, UseEndpointClientMethod, UseEndpointFormClient } from '${toImportPath(resolve('./runtime'))}'
import type { ServerRoutes } from '@nuxt/schema'
import type { TypedFetchMetadataField } from 'nuxt/app'
${serverRouteConfigImport}

type EndpointRouteMap = {
${endpointMap}
}
type EndpointRouteEntry = EndpointRouteMapValue<EndpointRouteMap>

type EndpointClientFeatures = ${clientFeatures}
type EndpointRouteForPathMethod<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = EndpointRouteMapEntry<EndpointRouteMap, PATH, METHOD>

export type $EndpointClient = EndpointMappedClient<EndpointRouteMap, EndpointClientFeatures>
export type EndpointPath = keyof EndpointRouteMap & string
export type EndpointMethod<PATH extends EndpointPath> = keyof EndpointRouteMap[PATH] & HttpMethod
export type $EndpointPathResponse<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = Awaited<$EndpointPathCall<PATH, METHOD>>
export type $EndpointPathCall<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = EndpointMappedPathCall<EndpointRouteMap, PATH, METHOD, EndpointClientFeatures>
export type $UseEndpoint = EndpointMappedUseClient<EndpointRouteMap>
export type $UseEndpointForm = UseEndpointFormClient<EndpointRouteEntry>
export type $UseEndpointPathCall<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = ReturnType<UseEndpointClientMethod<EndpointRouteForPathMethod<PATH, METHOD>, EndpointClientFeatures>>
${rawResponseType}
export type { EndpointClient, EndpointPathCall, UseEndpointClient, UseEndpointClientMethod, UseEndpointFormClient }
`.trimStart()
}
