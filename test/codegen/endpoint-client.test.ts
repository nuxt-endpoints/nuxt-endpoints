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

describe('generateEndpointClient', () => {
  it('embeds an empty route config for an empty handler list', () => {
    const content = generateEndpointClient(resolve, [], {
      client: { result: true, raw: true, effect: false },
    })

    expect(content).toContain('const routes = [] as const')
  })

  it('reflects operation and idempotency metadata into the runtime route config', () => {
    const content = generateEndpointClient(resolve, [createOrderHandler], {
      client: { result: true, raw: true, effect: false },
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
      client: { result: true, raw: true, effect: false },
    })

    expect(content).not.toContain('"operation"')
    expect(content).not.toContain('"idempotency"')
  })

  it('exports useEndpointResult and imports its factory only when result is enabled', () => {
    const enabled = generateEndpointClient(resolve, [healthHandler], {
      client: { result: true, raw: true, effect: false },
    })
    const disabled = generateEndpointClient(resolve, [healthHandler], {
      client: { result: false, raw: true, effect: false },
    })

    expect(enabled).toContain('createUseEndpointResult')
    expect(enabled).toContain('export const useEndpointResult =')
    expect(disabled).not.toContain('createUseEndpointResult')
    expect(disabled).not.toContain('useEndpointResult')
  })

  it('embeds the raw feature flag in the client features object', () => {
    const rawEnabled = generateEndpointClient(resolve, [healthHandler], {
      client: { result: true, raw: true, effect: false },
    })
    const rawDisabled = generateEndpointClient(resolve, [healthHandler], {
      client: { result: true, raw: false, effect: false },
    })

    expect(rawEnabled).toContain('{"result":true,"raw":true}')
    expect(rawDisabled).toContain('{"result":true,"raw":false}')
  })

  it('wires the effect extension into the client and exports useEndpointEffect when effect is enabled', () => {
    const content = generateEndpointClient(resolve, [healthHandler], {
      client: { result: true, raw: true, effect: true },
    })

    expect(content).toContain(
      "import { createEndpointEffectExtension, createUseEndpointEffect } from './runtime/effect'",
    )
    expect(content).toContain('extensions: [createEndpointEffectExtension()]')
    expect(content).toContain('export const useEndpointEffect =')
  })

  it('omits every effect wiring when effect is disabled', () => {
    const content = generateEndpointClient(resolve, [healthHandler], {
      client: { result: true, raw: true, effect: false },
    })

    expect(content).not.toContain('createEndpointEffectExtension')
    expect(content).not.toContain('useEndpointEffect')
    expect(content).not.toContain('extensions:')
  })
})
