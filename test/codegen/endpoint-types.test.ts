import { describe, expect, it } from 'vitest'
import { buildEndpointRouteEntryUnion, generateEndpointTypes } from '../../src/codegen'
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
      "definition: TypedFetchMetadataField<ServerRoutes, '/api/users', 'contract', 'get'>",
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
      "definition: TypedFetchMetadataField<ServerRoutes, '/api/multi', 'contract', 'get'>",
    )
    expect(union).toContain(
      "handlerReturn: EndpointHandlerReturnFromRoute<typeof import('/server/api/multi.ts').default['~routeDef'], 'get'>",
    )
    expect(union).toContain(
      "definition: TypedFetchMetadataField<ServerRoutes, '/api/multi', 'contract', 'put'>",
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

describe('generateEndpointTypes', () => {
  it('renders a never route entry union for an empty handler list', () => {
    const content = generateEndpointTypes(resolve, [], defaultClientOptions)

    expect(content).toContain('type EndpointRouteEntry =\n  | never')
  })

  it('imports the runtime client types via the resolver', () => {
    const content = generateEndpointTypes(resolve, [listUsersHandler], defaultClientOptions)

    expect(content).toContain(
      "import type { EndpointClient, EndpointHandlerReturnFromRoute, EndpointPathCall, UseEndpointClient, UseEndpointClientMethod } from './runtime'",
    )
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

  it('uses the plain EndpointClient type', () => {
    const content = generateEndpointTypes(resolve, [listUsersHandler], {
      client: { raw: true },
    })

    expect(content).toContain('export type $EndpointClient = EndpointClient<')
  })
})
