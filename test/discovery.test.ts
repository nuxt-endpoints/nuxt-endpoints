import { describe, expect, it } from 'vitest'
import {
  analyzeEndpointContractSource,
  assertEndpointModuleEvaluated,
  hasEndpointDefinition,
  resolveEndpointCarrierSource,
} from '../src/discovery'

describe('canonical route source discovery on Nitro 2', () => {
  it('skips ordinary Nitro routes and legacy NE authoring calls', async () => {
    expect(
      analyzeEndpointContractSource(`export default defineEventHandler(() => ({ ok: true }))`),
    ).toEqual({ kind: 'none' })
    expect(
      analyzeEndpointContractSource(
        `export default defineEndpoint({ handler: () => ({ ok: true }) })`,
      ),
    ).toEqual({ kind: 'none' })
    await expect(
      resolveEndpointCarrierSource(
        `export default defineEndpointHandler(endpoint, () => ({ ok: true }))`,
      ),
    ).resolves.toEqual({ kind: 'skip' })
  })

  it('detects single and multi-method canonical definitions', async () => {
    const single = `
      import { User } from '../contracts/user'
      export default defineRouteHandler({
        operation: 'getUser',
        validate: { response: { 200: User } },
        handler: () => ({ id: 1 }),
      })
    `
    const multi = `
      export default defineRouteHandler({
        get: { handler: () => ({ ok: true }) },
        put: { handler: () => ({ ok: true }) },
      })
    `

    expect(analyzeEndpointContractSource(single)).toEqual({ kind: 'co-located' })
    expect(analyzeEndpointContractSource(multi)).toEqual({ kind: 'co-located' })
    await expect(resolveEndpointCarrierSource(single)).resolves.toEqual({
      kind: 'route-module',
    })
  })

  it('allows comments between the canonical identifier and call', () => {
    expect(hasEndpointDefinition(`defineRouteHandler /* contract */ ({})`)).toBe(true)
  })

  it('ignores comments, strings, templates, member calls, aliases and declarations', () => {
    expect(hasEndpointDefinition(`// defineRouteHandler({})\ndefineEventHandler(() => ({}))`)).toBe(
      false,
    )
    expect(hasEndpointDefinition(`const text = 'defineRouteHandler({})'`)).toBe(false)
    expect(hasEndpointDefinition('const text = `defineRouteHandler({})`')).toBe(false)
    expect(hasEndpointDefinition(`factory.defineRouteHandler({})`)).toBe(false)
    expect(hasEndpointDefinition(`defineRouteHandlerAlias({})`)).toBe(false)
    expect(
      hasEndpointDefinition(`export function defineRouteHandler(definition) { return definition }`),
    ).toBe(false)
  })
})

describe('canonical route module evaluation', () => {
  it('ignores evaluation failures for ordinary Nitro routes', () => {
    expect(() =>
      assertEndpointModuleEvaluated(
        `export default defineEventHandler(() => ({ ok: true }))`,
        '/server/api/plain.get.ts',
        new Error('route import failed'),
      ),
    ).not.toThrow()
  })

  it('fails closed when a canonical route cannot be evaluated', () => {
    const evaluationError = new Error('route import failed')
    expect(() =>
      assertEndpointModuleEvaluated(
        `export default defineRouteHandler({ handler: () => ({ ok: true }) })`,
        '/server/api/items.get.ts',
        evaluationError,
      ),
    ).toThrow(/Nitro 2 has no route-contract provider/)
  })

  it('fails closed when the evaluated export has no metadata', () => {
    expect(() =>
      assertEndpointModuleEvaluated(
        `export default defineRouteHandler({ handler: () => ({ ok: true }) })`,
        '/server/api/items.get.ts',
      ),
    ).toThrow(/did not expose route contract metadata/)
  })
})
