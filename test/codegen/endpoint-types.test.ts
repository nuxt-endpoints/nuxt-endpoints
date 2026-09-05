import { describe, expect, it } from 'vitest'
import {
  buildEndpointRouteEntryUnion,
  buildEndpointRouteMap,
  generateEndpointTypes,
} from '../../src/codegen'
import type {
  EndpointClientCodegenOptions,
  EndpointRouteHandler,
  ResolvePath,
} from '../../src/codegen'

// Identity resolver: every codegen builder receives `resolver.resolve` from
// `@nuxt/kit`'s `createResolver`, but the builders themselves only ever
// forward its result into `toImportPath`, so a passthrough stands in for it.
const resolve: ResolvePath = (path) => path

const listUsersHandler: EndpointRouteHandler = {
  handler: '/server/api/users.get.ts',
  route: '/api/users',
  method: 'get',
}

const healthHandler: EndpointRouteHandler = {
  handler: '/server/api/health.get.ts',
  route: '/api/health',
  method: 'get',
}

const multiGetHandler: EndpointRouteHandler = {
  handler: '/server/api/multi.ts',
  route: '/api/multi',
  method: 'get',
  methodGroup: true,
}

const multiPutHandler: EndpointRouteHandler = {
  handler: '/server/api/multi.ts',
  route: '/api/multi',
  method: 'put',
  methodGroup: true,
}

const defaultClientOptions: EndpointClientCodegenOptions = {
  client: { raw: true },
}

describe('buildEndpointRouteEntryUnion', () => {
  it('renders a never union when there are no handlers', () => {
    expect(buildEndpointRouteEntryUnion([])).toBe('  | never')
  })

  it('embeds Nitro contract metadata and derives handler returns from the source definition', () => {
    const union = buildEndpointRouteEntryUnion([listUsersHandler])

    expect(union).toContain("path: '/api/users'")
    expect(union).toContain("method: 'get'")
    expect(union).toContain(
      "definition: ApplyEndpointPaginationFromRoute<TypedFetchMetadataField<ServerRoutes, '/api/users', 'contract', 'get'>",
    )
    expect(union).toContain(
      "handlerReturn: EndpointHandlerReturnFromRoute<typeof import('/server/api/users.get.ts').default['~routeDef'], 'get'>",
    )
  })

  it('joins multiple handlers as separate union members', () => {
    const union = buildEndpointRouteEntryUnion([listUsersHandler, healthHandler])

    expect(union.split('\n')).toHaveLength(2)
  })

  it('uses shared contract metadata and source-derived returns for every method', () => {
    const union = buildEndpointRouteEntryUnion([multiGetHandler, multiPutHandler])

    expect(union).toContain(
      "definition: ApplyEndpointPaginationFromRoute<TypedFetchMetadataField<ServerRoutes, '/api/multi', 'contract', 'get'>",
    )
    expect(union).toContain(
      "handlerReturn: EndpointHandlerReturnFromRoute<typeof import('/server/api/multi.ts').default['~routeDef'], 'get'>",
    )
    expect(union).toContain(
      "definition: ApplyEndpointPaginationFromRoute<TypedFetchMetadataField<ServerRoutes, '/api/multi', 'contract', 'put'>",
    )
    expect(union).toContain(
      "handlerReturn: EndpointHandlerReturnFromRoute<typeof import('/server/api/multi.ts').default['~routeDef'], 'put'>",
    )
    expect(union).not.toContain('__endpoint_contract')
    expect(union).not.toContain('__endpoint_handler_return')
  })

  it('does not reference private runtime carriers', () => {
    const union = buildEndpointRouteEntryUnion([listUsersHandler])

    expect(union).not.toContain('__endpoint_contract')
    expect(union).not.toContain('__endpoint_handler_return')
  })
})

describe('buildEndpointRouteMap', () => {
  it('renders an empty map body when there are no handlers', () => {
    expect(buildEndpointRouteMap([])).toBe('')
  })

  it('indexes methods below their path instead of leaving lookup to a route union', () => {
    const map = buildEndpointRouteMap([multiGetHandler, multiPutHandler, healthHandler])

    expect(map.match(/'\/api\/multi':/gu)).toHaveLength(1)
    expect(map).toContain("'get': { path: '/api/multi', method: 'get'")
    expect(map).toContain("'put': { path: '/api/multi', method: 'put'")
    expect(map).toContain("'/api/health':")
  })
})

describe('generateEndpointTypes', () => {
  it('renders an empty route map for an empty handler list', () => {
    const content = generateEndpointTypes(resolve, [], defaultClientOptions)

    expect(content).toContain('type EndpointRouteMap = {\n\n}')
    expect(content).toContain('type EndpointRouteEntry = EndpointRouteMapValue<EndpointRouteMap>')
  })

  it('imports the runtime client types via the resolver', () => {
    const content = generateEndpointTypes(resolve, [listUsersHandler], defaultClientOptions)

    expect(content).toContain('EndpointMappedClient')
    expect(content).toContain('EndpointRouteMapEntry')
    expect(content).toContain("from './runtime'")
    expect(content).toContain("import type { ServerRoutes } from '@nuxt/schema'")
    expect(content).toContain("import type { TypedFetchMetadataField } from 'nuxt/app'")
  })

  it('produces awaited path and raw response types', () => {
    const content = generateEndpointTypes(resolve, [listUsersHandler], {
      client: { raw: true },
    })

    expect(content).toContain('export type $EndpointPathResponse<')
    expect(content).toContain('export type $EndpointPathRawResponse<')
  })

  it('omits raw response helpers when raw is disabled', () => {
    const content = generateEndpointTypes(resolve, [listUsersHandler], {
      client: { raw: false },
    })

    expect(content).toContain(
      'export type $EndpointPathRawResponse<PATH extends EndpointPath, METHOD extends EndpointMethod<PATH>> = never',
    )
  })

  it('uses the indexed client type', () => {
    const content = generateEndpointTypes(resolve, [listUsersHandler], {
      client: { raw: true },
    })

    expect(content).toContain(
      'export type $EndpointClient = EndpointMappedClient<EndpointRouteMap, EndpointClientFeatures>',
    )
  })

  it('adds path-aware server responses from the central route config', () => {
    const content = generateEndpointTypes(resolve, [listUsersHandler], {
      client: { raw: true },
      serverRouteConfigPath: '/server/routes.config.ts',
    })

    expect(content).toContain(
      "serverResponses: ServerRouteResponsesFor<typeof import('/server/routes.config.ts').default, '/api/users', 'get'>",
    )
  })
})
