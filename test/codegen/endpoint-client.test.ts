import { describe, expect, it } from 'vitest'
import { generateEndpointClient } from '../../src/codegen'
import type { EndpointRouteHandler, ResolvePath } from '../../src/codegen'

const resolve: ResolvePath = (path) => path

const createOrderHandler: EndpointRouteHandler = {
  handler: '/server/api/orders.post.ts',
  route: '/api/orders',
  method: 'post',
  idempotency: { enabled: true, headerName: 'Idempotency-Key', required: true },
}

const healthHandler: EndpointRouteHandler = {
  handler: '/server/api/health.get.ts',
  route: '/api/health',
  method: 'get',
}

const exportUsersHandler: EndpointRouteHandler = {
  handler: '/server/api/export.get.ts',
  route: '/api/export',
  method: 'get',
  mediaResponse: true,
}

describe('generateEndpointClient', () => {
  it('embeds an empty route config for an empty handler list', () => {
    const content = generateEndpointClient(resolve, [], {
      client: { raw: true },
    })

    expect(content).toContain('const routes = [] as const')
  })

  it('reflects idempotency metadata into the runtime route config', () => {
    const content = generateEndpointClient(resolve, [createOrderHandler], {
      client: { raw: true },
    })

    expect(content).toContain('"path": "/api/orders"')
    expect(content).toContain('"method": "post"')
    expect(content).toContain('"idempotency": {')
    expect(content).toContain('"headerName": "Idempotency-Key"')
    expect(content).toContain('"required": true')
  })

  it('omits idempotency fields for handlers without them', () => {
    const content = generateEndpointClient(resolve, [healthHandler], {
      client: { raw: true },
    })

    expect(content).not.toContain('"idempotency"')
  })

  it('emits mediaResponse: true in the route config for a handler that declares one', () => {
    const content = generateEndpointClient(resolve, [exportUsersHandler], {
      client: { raw: true },
    })

    expect(content).toContain('"mediaResponse": true')
  })

  it('omits the mediaResponse field for handlers without one', () => {
    const content = generateEndpointClient(resolve, [healthHandler], {
      client: { raw: true },
    })

    expect(content).not.toContain('"mediaResponse"')
  })

  // `useFetch` swaps in `useRequestFetch()` for relative paths during SSR, so
  // the composables that stand in for it have to forward the request too.
  // Direct `$endpoint` awaits stand in for `$fetch`; query options need the
  // request-aware fetcher for Pinia Colada SSR.
  it('captures the request-aware fetcher for useEndpoint and endpoint query options', () => {
    const content = generateEndpointClient(resolve, [healthHandler], {
      client: { raw: true },
    })

    expect(content).toContain("import { useRequestFetch, useRequestHeaders } from 'nuxt/app'")
    expect(content).toContain('const captureFetcher = () => {')
    expect(content).toContain('$fetch.create({ headers: useRequestHeaders() })')
    expect(content).toContain(
      'export const useEndpoint = createUseEndpoint(routes, __useEndpointAsyncData, { features: {"raw":true}, captureFetcher })',
    )
    expect(content).toContain(
      'export const $endpoint = createEndpointClient(routes, { features: {"raw":true}, captureFetcher })',
    )
  })

  it('embeds the raw feature flag in the client features object', () => {
    const rawEnabled = generateEndpointClient(resolve, [healthHandler], {
      client: { raw: true },
    })
    const rawDisabled = generateEndpointClient(resolve, [healthHandler], {
      client: { raw: false },
    })

    expect(rawEnabled).toContain('{"raw":true}')
    expect(rawDisabled).toContain('{"raw":false}')
  })
})
