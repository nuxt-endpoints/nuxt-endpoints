import { describe, expect, it } from 'vitest'
import { assertEndpointModuleEvaluated, hasEndpointDefinition } from '../src/operation'

describe('endpoint source detection', () => {
  it('detects direct defineEndpoint calls', () => {
    expect(
      hasEndpointDefinition(`
      export const endpoint = defineEndpoint({
        operation: 'getUser',
        response: UserSchema,
      })
    `),
    ).toBe(true)
  })

  it('does not match ordinary handlers or defineEndpointHandler', () => {
    expect(
      hasEndpointDefinition(`
      export default defineEventHandler(() => ({ ok: true }))
    `),
    ).toBe(false)
    expect(
      hasEndpointDefinition(`
      export default defineEndpointHandler(endpoint, () => ({ ok: true }))
    `),
    ).toBe(false)
  })

  it('allows comments between the identifier and call', () => {
    expect(hasEndpointDefinition(`defineEndpoint /* contract */ ({})`)).toBe(true)
  })

  it('ignores comments, quoted values, templates, and member calls', () => {
    expect(hasEndpointDefinition(`// defineEndpoint({})\ndefineEventHandler(() => ({}))`)).toBe(
      false,
    )
    expect(hasEndpointDefinition(`/* defineEndpoint({}) */ defineEventHandler(() => ({}))`)).toBe(
      false,
    )
    expect(hasEndpointDefinition(`const text = 'defineEndpoint({})'`)).toBe(false)
    expect(hasEndpointDefinition('const text = `defineEndpoint({})`')).toBe(false)
    expect(hasEndpointDefinition(`factory.defineEndpoint({})`)).toBe(false)
  })
})

describe('endpoint module evaluation', () => {
  it('ignores evaluation failures for ordinary Nitro routes', () => {
    expect(() =>
      assertEndpointModuleEvaluated(
        `export default defineEventHandler(() => ({ ok: true }))`,
        '/server/api/plain.get.ts',
        new Error('route import failed'),
      ),
    ).not.toThrow()
  })

  it('fails closed when endpoint metadata cannot be evaluated', () => {
    const evaluationError = new Error('route import failed')

    expect(() =>
      assertEndpointModuleEvaluated(
        `export const endpoint = defineEndpoint({ operation: 'createItem' })`,
        '/server/api/items.post.ts',
        evaluationError,
      ),
    ).toThrow(/could not evaluate endpoint route.*items\.post\.ts/i)
  })

  it('fails closed when evaluated exports do not expose endpoint metadata', () => {
    expect(() =>
      assertEndpointModuleEvaluated(
        `export const endpoint = defineEndpoint({ operation: 'getItem' })`,
        '/server/api/items.get.ts',
      ),
    ).toThrow(/evaluated exports did not expose endpoint metadata/i)
  })
})
