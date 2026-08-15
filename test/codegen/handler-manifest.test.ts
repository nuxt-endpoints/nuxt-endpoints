import { describe, expect, it } from 'vitest'
import { generateEndpointHandlerManifest } from '../../src/codegen'

describe('generateEndpointHandlerManifest', () => {
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

  it('generates entries for every handler, in order', () => {
    const content = generateEndpointHandlerManifest([
      { handler: '/server/api/users.get.ts', route: '/api/users', method: 'get' },
      { handler: '/server/api/users.post.ts', route: '/api/users', method: 'post' },
    ])

    const firstIndex = content.indexOf('route: "/api/users"')
    const secondIndex = content.indexOf('route: "/api/users"', firstIndex + 1)
    expect(firstIndex).toBeGreaterThanOrEqual(0)
    expect(secondIndex).toBeGreaterThan(firstIndex)
    expect(content).toContain('method: "get"')
    expect(content).toContain('method: "post"')
  })

  it('generates an empty manifest when no endpoints were detected', () => {
    expect(generateEndpointHandlerManifest([])).toBe('export const handlers = []\n')
  })
})
