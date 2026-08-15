import { describe, expect, it } from 'vitest'
import {
  generateEndpointQueryClient,
  generateEndpointQueryPlugin,
  generateEndpointQueryTypes,
} from '../../src/codegen'
import type { EndpointRouteHandler, ResolvePath } from '../../src/codegen'

const resolve: ResolvePath = (path) => path

const createOrderHandler: EndpointRouteHandler = {
  handler: '/server/api/orders.post.ts',
  route: '/api/orders',
  method: 'post',
  operation: 'createOrder',
  idempotency: { enabled: true, headerName: 'Idempotency-Key', required: true },
}

describe('generateEndpointQueryTypes', () => {
  it('renders a never route entry union for an empty handler list', () => {
    const content = generateEndpointQueryTypes(resolve, [])

    expect(content).toContain('type EndpointRouteEntry =\n  | never')
  })

  it('imports the query adapter types via the resolver', () => {
    const content = generateEndpointQueryTypes(resolve, [createOrderHandler])

    expect(content).toContain(
      "import type { EndpointInfiniteQueryOptionsClient, EndpointMutationOptionsClient, EndpointQueryOptionsClient } from './runtime/tanstack-query'",
    )
  })

  it('embeds the operation name in the route entry union', () => {
    const content = generateEndpointQueryTypes(resolve, [createOrderHandler])

    expect(content).toContain("operation: 'createOrder'")
  })
})

describe('generateEndpointQueryClient', () => {
  it('reflects operation and idempotency metadata into the runtime route config', () => {
    const content = generateEndpointQueryClient(resolve, '/build/types/endpoints-query.d.ts', [
      createOrderHandler,
    ])

    expect(content).toContain('"operation": "createOrder"')
    expect(content).toContain('"headerName": "Idempotency-Key"')
    expect(content).toContain('"required": true')
  })

  it('imports runtime and type modules from the resolver and the query type file', () => {
    const content = generateEndpointQueryClient(resolve, '/build/types/endpoints-query.d.ts', [
      createOrderHandler,
    ])

    expect(content).toContain(
      "createEndpointInfiniteQueryOptions, createEndpointMutationOptions, createEndpointQueryOptions } from './runtime/tanstack-query'",
    )
    expect(content).toContain(
      "import type { $EndpointInfiniteQueryOptions, $EndpointMutationOptions, $EndpointQueryOptions } from '/build/types/endpoints-query'",
    )
  })

  it('captures a request-aware fetcher through useRequestFetch', () => {
    const content = generateEndpointQueryClient(resolve, '/build/types/endpoints-query.d.ts', [
      createOrderHandler,
    ])

    expect(content).toContain("useRequestFetch } from 'nuxt/app'")
    expect(content).toContain('const captureFetcher = ()')
    expect(content).toContain('useRequestFetch()')
  })
})

describe('generateEndpointQueryPlugin', () => {
  it('embeds the configured staleTime into the default query options', () => {
    expect(generateEndpointQueryPlugin(60_000)).toContain('staleTime: 60000,')
    expect(generateEndpointQueryPlugin(5_000)).toContain('staleTime: 5000,')
  })

  it('dehydrates on the server and hydrates on the client', () => {
    const content = generateEndpointQueryPlugin(60_000)

    expect(content).toContain('if (import.meta.server)')
    expect(content).toContain('vueQueryState.value = dehydrate(queryClient)')
    expect(content).toContain('if (import.meta.client)')
    expect(content).toContain('hydrate(queryClient, vueQueryState.value)')
  })
})
