import { toImportPath } from './shared'
import type { EndpointClientCodegenOptions, EndpointRouteHandler, ResolvePath } from './types'

// Exported so the query adapter's type generator (query-adapter.ts) can build
// the same `EndpointRouteEntry` union without duplicating this logic.
export function buildEndpointRouteEntryUnion(handlers: readonly EndpointRouteHandler[]): string {
  return handlers.length
    ? handlers
        .map((handler) => {
          const operation = handler.operation ? `, operation: '${handler.operation}'` : ''
          const definitionAccessor = `TypedFetchMetadataField<InternalRouteSchema, '${handler.route}', 'contract', '${handler.method}'>`
          const handlerReturnAccessor = `TypedFetchMetadataField<InternalRouteSchema, '${handler.route}', 'handlerReturn', '${handler.method}'>`
          return `  | { path: '${handler.route}', method: '${handler.method}'${operation}, definition: ${definitionAccessor}, handlerReturn: ${handlerReturnAccessor} }`
        })
        .join('\n')
    : '  | never'
}

// Pure builder: returns the `types/endpoints.d.ts` content. Writing it to disk
// is module.ts's responsibility (via its `writeGenerated` helper), so this
// generator can be unit tested without touching the filesystem.
export function generateEndpointTypes(
  resolve: ResolvePath,
  handlers: readonly EndpointRouteHandler[],
  options: EndpointClientCodegenOptions,
): string {
  const endpointUnion = buildEndpointRouteEntryUnion(handlers)
  const clientFeatures = `{
  result: ${options.client.result ? 'true' : 'false'}
  raw: ${options.client.raw ? 'true' : 'false'}
}`
  const resultType = options.client.result
    ? "\nexport type $EndpointResult<OPERATION extends EndpointOperation> = Awaited<ReturnType<$EndpointCall<OPERATION>['result']>>\nexport type $EndpointPathResult<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = Awaited<ReturnType<$EndpointPathCall<PATH, METHOD>['result']>>"
    : '\nexport type $EndpointResult<OPERATION extends EndpointOperation> = never\nexport type $EndpointPathResult<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = never'
  const rawResponseType = options.client.raw
    ? "\nexport type $EndpointRawResponse<OPERATION extends EndpointOperation> = Awaited<ReturnType<$EndpointCall<OPERATION>['raw']>>\nexport type $EndpointPathRawResponse<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = Awaited<ReturnType<$EndpointPathCall<PATH, METHOD>['raw']>>"
    : '\nexport type $EndpointRawResponse<OPERATION extends EndpointOperation> = never\nexport type $EndpointPathRawResponse<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = never'
  const useEndpointResultType = options.client.result
    ? '\nexport type $UseEndpointResult = UseEndpointResultClient<EndpointRouteEntry, EndpointClientFeatures>\nexport type $UseEndpointResultPathCall<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = ReturnType<UseEndpointResultClientMethod<EndpointRouteForPathMethod<PATH, METHOD>, EndpointClientFeatures>>'
    : '\nexport type $UseEndpointResult = never\nexport type $UseEndpointResultPathCall<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = never'

  return `
import type { EndpointClient, EndpointOperationCall, EndpointPathCall, UseEndpointClient, UseEndpointClientMethod, UseEndpointResultClient, UseEndpointResultClientMethod } from '${toImportPath(resolve('./runtime'))}'
import type { InternalRouteSchema, TypedFetchMetadataField } from 'nitro/types'

type EndpointRouteEntry =
${endpointUnion}

type EndpointClientFeatures = ${clientFeatures}
type EndpointOperationFrom<ROUTE> = ROUTE extends { operation: infer OPERATION extends string } ? OPERATION : never
type EndpointRouteForPath<PATH extends EndpointPath> = Extract<EndpointRouteEntry, { path: PATH }>
type EndpointRouteForPathMethod<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = Extract<EndpointRouteEntry, { path: PATH, method: METHOD }>

export type $EndpointClient = EndpointClient<EndpointRouteEntry, EndpointClientFeatures>
export type EndpointOperation = EndpointOperationFrom<EndpointRouteEntry>
export type EndpointPath = EndpointRouteEntry['path']
export type EndpointMethod<PATH extends EndpointPath> = EndpointRouteForPath<PATH>['method']
export type $EndpointResponse<OPERATION extends EndpointOperation> = Awaited<$EndpointCall<OPERATION>>
export type $EndpointCall<OPERATION extends EndpointOperation> = EndpointOperationCall<EndpointRouteEntry, OPERATION, EndpointClientFeatures>
export type $EndpointPathResponse<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = Awaited<$EndpointPathCall<PATH, METHOD>>
export type $EndpointPathCall<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = EndpointPathCall<EndpointRouteEntry, PATH, METHOD, EndpointClientFeatures>
export type $UseEndpoint = UseEndpointClient<EndpointRouteEntry, EndpointClientFeatures>
export type $UseEndpointPathCall<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = ReturnType<UseEndpointClientMethod<EndpointRouteForPathMethod<PATH, METHOD>, EndpointClientFeatures>>
${useEndpointResultType}${resultType}${rawResponseType}
export type { EndpointClient, EndpointOperationCall, EndpointPathCall, UseEndpointClient, UseEndpointClientMethod, UseEndpointResultClient, UseEndpointResultClientMethod }
`.trimStart()
}
