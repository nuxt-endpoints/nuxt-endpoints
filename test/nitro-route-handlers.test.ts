import { describe, expect, it } from 'vitest'
import {
  collectNitroRouteHandlers,
  generateEndpointHandlerManifest,
} from '../src/nitro-route-handlers'

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

  it('generates a module-owned runtime manifest with normalized import paths', () => {
    expect(
      generateEndpointHandlerManifest([
        {
          handler: 'C:\\project\\server\\api\\users.get.ts',
          route: '/api/users',
          method: 'get',
        },
      ]),
    ).toBe(`export const handlers = [
  {
    route: "/api/users",
    method: "get",
    load: () => import("C:/project/server/api/users.get.ts").then((module) => module.default),
  }
]\n`)
  })

  it('generates an empty manifest when no endpoints were detected', () => {
    expect(generateEndpointHandlerManifest([])).toBe('export const handlers = []\n')
  })
})
