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
  operation: 'listUsers',
}

const healthHandler: EndpointRouteHandler = {
  handler: '/server/api/health.get.ts',
  route: '/api/health',
  method: 'get',
}

const defaultClientOptions: EndpointClientCodegenOptions = {
  client: { result: true, raw: true, effect: false },
}

describe('buildEndpointRouteEntryUnion', () => {
  it('renders a never union when there are no handlers', () => {
    expect(buildEndpointRouteEntryUnion([])).toBe('  | never')
  })

  it('embeds the operation name when the handler declares one', () => {
    const union = buildEndpointRouteEntryUnion([listUsersHandler])

    expect(union).toContain("path: '/api/users'")
    expect(union).toContain("method: 'get'")
    expect(union).toContain("operation: 'listUsers'")
    expect(union).toContain(
      "definition: typeof import('/server/api/users.get.ts').default['__endpoint_contract__']['definition']",
    )
    expect(union).toContain(
      "handlerReturn: typeof import('/server/api/users.get.ts').default['__endpoint_handler_return__']",
    )
  })

  it('omits the operation field entirely when the handler has none', () => {
    const union = buildEndpointRouteEntryUnion([healthHandler])

    expect(union).not.toContain('operation:')
  })

  it('joins multiple handlers as separate union members', () => {
    const union = buildEndpointRouteEntryUnion([listUsersHandler, healthHandler])

    expect(union.split('\n')).toHaveLength(2)
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
      "import type { EndpointClient, EndpointOperationCall, EndpointPathCall, UseEndpointClient, UseEndpointClientMethod, UseEndpointResultClient, UseEndpointResultClientMethod } from './runtime'",
    )
  })

  it('produces real result/raw response types when both client features are enabled', () => {
    const content = generateEndpointTypes(resolve, [listUsersHandler], {
      client: { result: true, raw: true, effect: false },
    })

    expect(content).toContain(
      "export type $EndpointResult<OPERATION extends EndpointOperation> = Awaited<ReturnType<$EndpointCall<OPERATION>['result']>>",
    )
    expect(content).toContain(
      "export type $EndpointRawResponse<OPERATION extends EndpointOperation> = Awaited<ReturnType<$EndpointCall<OPERATION>['raw']>>",
    )
  })

  it('degrades result/raw response types to never when both client features are disabled', () => {
    const content = generateEndpointTypes(resolve, [listUsersHandler], {
      client: { result: false, raw: false, effect: false },
    })

    expect(content).toContain(
      'export type $EndpointResult<OPERATION extends EndpointOperation> = never',
    )
    expect(content).toContain(
      'export type $EndpointRawResponse<OPERATION extends EndpointOperation> = never',
    )
  })

  it('uses the plain EndpointClient type and skips the effect import when effect is disabled', () => {
    const content = generateEndpointTypes(resolve, [listUsersHandler], {
      client: { result: true, raw: true, effect: false },
    })

    expect(content).toContain('export type $EndpointClient = EndpointClient<')
    expect(content).not.toContain('EffectEndpointClient')
    expect(content).not.toContain("from './runtime/effect'")
    expect(content).toContain('export type $UseEndpointEffect = never')
  })

  it('switches to the effect client type and imports effect types when effect is enabled', () => {
    const content = generateEndpointTypes(resolve, [listUsersHandler], {
      client: { result: true, raw: true, effect: true },
    })

    expect(content).toContain(
      "import type { EffectEndpointClient, EffectEndpointOperationCall, EffectEndpointPathCall, UseEndpointEffectClient, UseEndpointEffectClientMethod } from './runtime/effect'",
    )
    expect(content).toContain('export type $EndpointClient = EffectEndpointClient<')
    expect(content).toContain(
      'export type $UseEndpointEffect = UseEndpointEffectClient<EndpointRouteEntry, EndpointClientFeatures>',
    )
  })
})
