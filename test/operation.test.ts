import { describe, expect, it } from 'vitest'
import {
  assertEndpointSourceFallbackSafe,
  extractOperation,
  hasEndpointDefinition,
  hasIdempotencyDeclaration,
} from '../src/operation'

describe('extractOperation', () => {
  it('extracts literal operation values from defineEndpoint calls', () => {
    expect(
      extractOperation(`
      export const endpoint = defineEndpoint({
        operation: 'getUser',
        response: UserSchema,
      })
    `),
    ).toBe('getUser')
  })

  it('returns null when the file is not a endpoint contract', () => {
    expect(
      extractOperation(`
      export default defineEventHandler(() => ({ ok: true }))
    `),
    ).toBeNull()
  })

  it('returns null when operation is not a literal contract value', () => {
    expect(
      extractOperation(`
      const operation = 'getUser'
      export const endpoint = defineEndpoint({
        response: UserSchema,
      })
    `),
    ).toBeNull()
  })

  it('detects endpoint contracts without operation names', () => {
    const source = `
      export const endpoint = defineEndpoint({
        response: UserSchema,
      })
    `

    expect(hasEndpointDefinition(source)).toBe(true)
    expect(extractOperation(source)).toBeNull()
  })

  it('does not confuse defineEndpointHandler with defineEndpoint', () => {
    expect(
      hasEndpointDefinition(`
      export default defineEndpointHandler(endpoint, () => ({ ok: true }))
    `),
    ).toBe(false)
  })
})

describe('idempotent endpoint source fallback', () => {
  it('conservatively detects property and bracket API call syntax', () => {
    expect(hasIdempotencyDeclaration(`defineEndpoint({})\n.idempotency /* policy */ ({})`)).toBe(
      true,
    )
    expect(hasIdempotencyDeclaration(`defineEndpoint({})['idempotency']({})`)).toBe(true)
    expect(hasIdempotencyDeclaration(`defineEndpoint({ operation: 'plain' })`)).toBe(false)
  })

  it('rejects source fallback when idempotency policy cannot be evaluated', () => {
    const evaluationError = new Error('route import failed')

    expect(() =>
      assertEndpointSourceFallbackSafe(
        `defineEndpoint({})['idempotency']({ authorization: 'middleware' })`,
        '/server/api/items.post.ts',
        evaluationError,
      ),
    ).toThrow(/cannot be recovered safely/i)
  })
})
