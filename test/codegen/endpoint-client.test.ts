import { describe, expect, it } from 'vitest'
import { generateEndpointClient } from '../../src/codegen'
import type { EndpointRouteHandler, ResolvePath } from '../../src/codegen'

const resolve: ResolvePath = (path) => path

const createOrderHandler: EndpointRouteHandler = {
  handler: '/server/api/orders.post.ts',
  route: '/api/orders',
  method: 'post',
  operation: 'createOrder',
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
  operation: 'exportUsers',
  mediaResponse: true,
}

describe('generateEndpointClient', () => {
  it('embeds an empty route config for an empty handler list', () => {
    const content = generateEndpointClient(resolve, [], {
      client: { result: true, raw: true },
    })

    expect(content).toContain('const routes = [] as const')
  })

  it('reflects operation and idempotency metadata into the runtime route config', () => {
    const content = generateEndpointClient(resolve, [createOrderHandler], {
      client: { result: true, raw: true },
    })

    expect(content).toContain('"path": "/api/orders"')
    expect(content).toContain('"method": "post"')
    expect(content).toContain('"operation": "createOrder"')
    expect(content).toContain('"idempotency": {')
    expect(content).toContain('"headerName": "Idempotency-Key"')
    expect(content).toContain('"required": true')
  })

  it('omits the operation and idempotency fields for handlers without them', () => {
    const content = generateEndpointClient(resolve, [healthHandler], {
      client: { result: true, raw: true },
    })

    expect(content).not.toContain('"operation"')
    expect(content).not.toContain('"idempotency"')
  })

  it('emits mediaResponse: true in the route config for a handler that declares one', () => {
    const content = generateEndpointClient(resolve, [exportUsersHandler], {
      client: { result: true, raw: true },
    })

    expect(content).toContain('"mediaResponse": true')
  })

  it('omits the mediaResponse field for handlers without one', () => {
    const content = generateEndpointClient(resolve, [healthHandler], {
      client: { result: true, raw: true },
    })

    expect(content).not.toContain('"mediaResponse"')
  })

  it('exports useEndpointResult and imports its factory only when result is enabled', () => {
    const enabled = generateEndpointClient(resolve, [healthHandler], {
      client: { result: true, raw: true },
    })
    const disabled = generateEndpointClient(resolve, [healthHandler], {
      client: { result: false, raw: true },
    })

    expect(enabled).toContain('createUseEndpointResult')
    expect(enabled).toContain('export const useEndpointResult =')
    expect(disabled).not.toContain('createUseEndpointResult')
    expect(disabled).not.toContain('useEndpointResult')
  })

  // `useFetch` swaps in `useRequestFetch()` for relative paths during SSR, so
  // the composables that stand in for it have to forward the request too.
  // `$endpoint` stands in for `$fetch`, which does not.
  it('captures the request-aware fetcher for the useEndpoint family only', () => {
    const content = generateEndpointClient(resolve, [healthHandler], {
      client: { result: true, raw: true },
    })

    expect(content).toContain("import { useRequestFetch } from 'nuxt/app'")
    expect(content).toContain('const captureFetcher = () => {')
    expect(content).toContain(
      'export const useEndpoint = createUseEndpoint(routes, __useEndpointAsyncData, { features: {"result":true,"raw":true}, captureFetcher })',
    )
    expect(content).toContain(
      'export const useEndpointResult = createUseEndpointResult(routes, __useEndpointAsyncData, { features: {"result":true,"raw":true}, captureFetcher })',
    )
    expect(content).toContain(
      'export const $endpoint = createEndpointClient(routes, { features: {"result":true,"raw":true} })',
    )
  })

  it('embeds the raw feature flag in the client features object', () => {
    const rawEnabled = generateEndpointClient(resolve, [healthHandler], {
      client: { result: true, raw: true },
    })
    const rawDisabled = generateEndpointClient(resolve, [healthHandler], {
      client: { result: true, raw: false },
    })

    expect(rawEnabled).toContain('{"result":true,"raw":true}')
    expect(rawDisabled).toContain('{"result":true,"raw":false}')
  })
})
