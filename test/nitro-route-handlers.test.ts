import { describe, expect, it } from 'vitest'
import { collectNitroRouteHandlers } from '../src/nitro-route-handlers'

describe('collectNitroRouteHandlers', () => {
  it('combines scanned and explicitly configured handlers in Nitro order', () => {
    const scannedHandler = {
      handler: '/server/api/users.get.ts',
      route: '/api/users',
      method: 'get',
    }
    const configuredHandler = {
      handler: '/server/api/health.ts',
      route: '/api/health',
      method: 'get',
    }

    expect(
      collectNitroRouteHandlers({
        scannedHandlers: [scannedHandler],
        options: { handlers: [configuredHandler] },
      }),
    ).toEqual([scannedHandler, configuredHandler])
  })
})
