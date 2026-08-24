import { describe, expect, it, vi } from 'vitest'
import {
  analyzeEndpointContractSource,
  assertEndpointModuleEvaluated,
  hasEndpointDefinition,
  resolveEndpointCarrierSource,
} from '../src/discovery'
import type { ContractModuleLoaders } from '../src/discovery'

describe('analyzeEndpointContractSource', () => {
  it('reports none for ordinary Nitro routes', () => {
    expect(
      analyzeEndpointContractSource(`
        export default defineEventHandler(() => ({ ok: true }))
      `),
    ).toEqual({ kind: 'none' })
  })

  it('reports co-located for the single-define form', () => {
    expect(
      analyzeEndpointContractSource(`
        export default defineEndpoint({
          operation: 'getUser',
          handler: () => ({ ok: true }),
        })
      `),
    ).toEqual({ kind: 'co-located' })
  })

  // The `default` exception added for the form above must not re-admit this
  // library's own declaration, which is what the preceding-identifier check
  // exists to exclude in the first place.
  it('still ignores a `defineEndpoint` function declaration', () => {
    expect(
      analyzeEndpointContractSource(`
        export function defineEndpoint(definition) {
          return definition
        }
      `),
    ).toEqual({ kind: 'none' })
  })

  it('reports co-located when the endpoint is defined alongside its handler', () => {
    expect(
      analyzeEndpointContractSource(`
        export const endpoint = defineEndpoint({
          operation: 'getUser',
        })

        export default defineEndpointHandler(endpoint, () => ({ ok: true }))
      `),
    ).toEqual({ kind: 'co-located' })
  })

  it('reports co-located for an inline defineEndpointMethods() group', () => {
    expect(
      analyzeEndpointContractSource(`
        export const endpoints = defineEndpointMethods({
          get: defineEndpoint({ operation: 'getMulti' }),
          put: defineEndpoint({ operation: 'putMulti' }),
        })

        export default defineEndpointMethodHandlers(endpoints, {
          get: () => ({ ok: true }),
          put: () => ({ ok: true }),
        })
      `),
    ).toEqual({ kind: 'co-located' })
  })

  it('resolves a named import passed to defineEndpointMethodHandlers as the group contract', () => {
    expect(
      analyzeEndpointContractSource(`
        import { endpoints } from './contract'

        export default defineEndpointMethodHandlers(endpoints, {
          get: () => ({ ok: true }),
          put: () => ({ ok: true }),
        })
      `),
    ).toEqual({ kind: 'imported', specifier: './contract', importedName: 'endpoints' })
  })

  it('resolves a named import passed to defineEndpointHandler', () => {
    expect(
      analyzeEndpointContractSource(`
        import { endpoint } from './contract'

        export default defineEndpointHandler(endpoint, () => ({ ok: true }))
      `),
    ).toEqual({ kind: 'imported', specifier: './contract', importedName: 'endpoint' })
  })

  it('resolves an aliased named import to its original export name', () => {
    expect(
      analyzeEndpointContractSource(`
        import { userContract as endpoint } from './contract'

        export default defineEndpointHandler(endpoint, () => ({ ok: true }))
      `),
    ).toEqual({ kind: 'imported', specifier: './contract', importedName: 'userContract' })
  })

  it('resolves a default import as importedName "default"', () => {
    expect(
      analyzeEndpointContractSource(`
        import endpoint from './contract'

        export default defineEndpointHandler(endpoint, () => ({ ok: true }))
      `),
    ).toEqual({ kind: 'imported', specifier: './contract', importedName: 'default' })
  })

  it('reports unresolved when only a type-only import binds the identifier', () => {
    expect(
      analyzeEndpointContractSource(`
        import type { endpoint } from './contract'

        export default defineEndpointHandler(endpoint, () => ({ ok: true }))
      `),
    ).toEqual({ kind: 'unresolved' })
  })

  it('ignores type-only specifiers within a named import group', () => {
    expect(
      analyzeEndpointContractSource(`
        import { type A, endpoint } from './contract'

        export default defineEndpointHandler(endpoint, () => ({ ok: true }))
      `),
    ).toEqual({ kind: 'imported', specifier: './contract', importedName: 'endpoint' })
  })

  it('reports unresolved for a member-expression argument', () => {
    expect(
      analyzeEndpointContractSource(`
        import * as c from './contract'

        export default defineEndpointHandler(c.endpoint, () => ({ ok: true }))
      `),
    ).toEqual({ kind: 'unresolved' })
  })

  it('reports unresolved when the identifier has no matching import (auto-import or local)', () => {
    expect(
      analyzeEndpointContractSource(`
        export default defineEndpointHandler(endpoint, () => ({ ok: true }))
      `),
    ).toEqual({ kind: 'unresolved' })
  })

  it('ignores defineEndpointHandler( inside comments and quoted values', () => {
    expect(
      analyzeEndpointContractSource(`
        // defineEndpointHandler(endpoint, () => ({}))
        /* defineEndpointHandler(endpoint, () => ({})) */
        const text = 'defineEndpointHandler(endpoint, () => ({}))'
        const template = \`defineEndpointHandler(endpoint, () => ({}))\`
        export default defineEventHandler(() => ({ ok: true }))
      `),
    ).toEqual({ kind: 'none' })
  })

  it('handles multi-line imports and multi-line defineEndpointHandler calls', () => {
    expect(
      analyzeEndpointContractSource(`
        import {
          endpoint,
        } from './contract'

        export default defineEndpointHandler(
          // the contract module keeps the route free of top-level side effects
          endpoint,
          () => ({ ok: true }),
        )
      `),
    ).toEqual({ kind: 'imported', specifier: './contract', importedName: 'endpoint' })
  })
})

describe('resolveEndpointCarrierSource', () => {
  function createLoaders(overrides: Partial<ContractModuleLoaders> = {}): ContractModuleLoaders {
    return {
      loadModule: vi.fn(async () => ({ module: {} })),
      resolveImport: vi.fn(() => undefined),
      ...overrides,
    }
  }

  it('never loads the route module when the endpoint is imported from a contract module', async () => {
    const carrier = { definition: { operation: 'getUser' } }
    const loadModule = vi.fn(async (path: string) =>
      path === '/server/contracts/user.ts'
        ? { module: { endpoint: carrier } }
        : { error: new Error('unexpected') },
    )
    const resolveImport = vi.fn(() => '/server/contracts/user.ts')
    const loaders = createLoaders({ loadModule, resolveImport })

    const result = await resolveEndpointCarrierSource(
      `
        import { endpoint } from './contracts/user'
        export default defineEndpointHandler(endpoint, () => ({ ok: true }))
      `,
      '/server/api/user.get.ts',
      loaders,
    )

    expect(result).toEqual({ kind: 'contract', carrier })
    expect(resolveImport).toHaveBeenCalledWith('./contracts/user', '/server/api/user.get.ts')
    expect(loadModule).toHaveBeenCalledTimes(1)
    expect(loadModule).toHaveBeenCalledWith('/server/contracts/user.ts')
    expect(loadModule).not.toHaveBeenCalledWith('/server/api/user.get.ts')
  })

  it('never calls loadModule for a plain, non-endpoint route', async () => {
    const loadModule = vi.fn(async () => ({ module: {} }))
    const loaders = createLoaders({ loadModule })

    const result = await resolveEndpointCarrierSource(
      `export default defineEventHandler(() => ({ ok: true }))`,
      '/server/api/plain.get.ts',
      loaders,
    )

    expect(result).toEqual({ kind: 'skip' })
    expect(loadModule).not.toHaveBeenCalled()
  })

  it('defers to route-module evaluation for co-located endpoint definitions', async () => {
    const loaders = createLoaders()

    const result = await resolveEndpointCarrierSource(
      `
        export const endpoint = defineEndpoint({ operation: 'getUser' })
        export default defineEndpointHandler(endpoint, () => ({ ok: true }))
      `,
      '/server/api/user.get.ts',
      loaders,
    )

    expect(result).toEqual({ kind: 'route-module' })
  })

  it('throws when the contract specifier cannot be resolved', async () => {
    const loaders = createLoaders({ resolveImport: vi.fn(() => undefined) })

    await expect(
      resolveEndpointCarrierSource(
        `
          import { endpoint } from './missing-contract'
          export default defineEndpointHandler(endpoint, () => ({ ok: true }))
        `,
        '/server/api/user.get.ts',
        loaders,
      ),
    ).rejects.toThrow(
      /Route \/server\/api\/user\.get\.ts imports its endpoint from "\.\/missing-contract", which could not be resolved/,
    )
  })

  it('throws with a cause when the contract module fails to evaluate', async () => {
    const evaluationError = new Error('boom')
    const loaders = createLoaders({
      resolveImport: vi.fn(() => '/server/contracts/user.ts'),
      loadModule: vi.fn(async () => ({ error: evaluationError })),
    })

    const rejection = resolveEndpointCarrierSource(
      `
        import { endpoint } from './contracts/user'
        export default defineEndpointHandler(endpoint, () => ({ ok: true }))
      `,
      '/server/api/user.get.ts',
      loaders,
    )

    await expect(rejection).rejects.toThrow(
      /Could not evaluate endpoint contract module \/server\/contracts\/user\.ts/,
    )
    await expect(rejection).rejects.toMatchObject({ cause: evaluationError })
  })

  it('throws when the imported export does not expose endpoint metadata', async () => {
    const loaders = createLoaders({
      resolveImport: vi.fn(() => '/server/contracts/user.ts'),
      loadModule: vi.fn(async () => ({ module: { endpoint: { notAnEndpoint: true } } })),
    })

    await expect(
      resolveEndpointCarrierSource(
        `
          import { endpoint } from './contracts/user'
          export default defineEndpointHandler(endpoint, () => ({ ok: true }))
        `,
        '/server/api/user.get.ts',
        loaders,
      ),
    ).rejects.toThrow(
      /passes "endpoint" imported from "\.\/contracts\/user" to defineEndpointHandler\(\), but it does not expose endpoint metadata/,
    )
  })

  it('never loads the route module when a method group is imported from a contract module', async () => {
    const carrier = {
      __endpoint_methods__: true,
      methods: {
        get: { definition: { operation: 'getMulti' } },
        put: { definition: { operation: 'putMulti' } },
      },
    }
    const loadModule = vi.fn(async (path: string) =>
      path === '/server/contracts/multi.ts'
        ? { module: { endpoints: carrier } }
        : { error: new Error('unexpected') },
    )
    const resolveImport = vi.fn(() => '/server/contracts/multi.ts')
    const loaders = createLoaders({ loadModule, resolveImport })

    const result = await resolveEndpointCarrierSource(
      `
        import { endpoints } from './contracts/multi'
        export default defineEndpointMethodHandlers(endpoints, { get: () => ({}), put: () => ({}) })
      `,
      '/server/api/multi.ts',
      loaders,
    )

    expect(result).toEqual({ kind: 'contract', carrier })
    expect(loadModule).toHaveBeenCalledTimes(1)
    expect(loadModule).toHaveBeenCalledWith('/server/contracts/multi.ts')
    expect(loadModule).not.toHaveBeenCalledWith('/server/api/multi.ts')
  })

  it('extracts the default export as the carrier', async () => {
    const carrier = { definition: { operation: 'getUser' } }
    const loadModule = vi.fn(async () => ({ module: { default: carrier } }))
    const loaders = createLoaders({
      resolveImport: vi.fn(() => '/server/contracts/user.ts'),
      loadModule,
    })

    const result = await resolveEndpointCarrierSource(
      `
        import endpoint from './contracts/user'
        export default defineEndpointHandler(endpoint, () => ({ ok: true }))
      `,
      '/server/api/user.get.ts',
      loaders,
    )

    expect(result).toEqual({ kind: 'contract', carrier })
  })
})

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

  it('detects an inline defineEndpointMethods() group call', () => {
    expect(
      hasEndpointDefinition(`
      export const endpoints = defineEndpointMethods({
        get: defineEndpoint({ operation: 'getMulti' }),
      })
    `),
    ).toBe(true)
  })

  it('does not match defineEndpointMethodHandlers even though it starts with defineEndpointMethods', () => {
    // A route file that only imports its group contract calls
    // defineEndpointMethodHandlers() but never defineEndpointMethods()
    // itself; hasEndpointDefinition must stay false so this route is treated
    // as an imported-contract case, not a co-located one.
    expect(
      hasEndpointDefinition(`
      import { endpoints } from './contract'
      export default defineEndpointMethodHandlers(endpoints, { get: () => ({ ok: true }) })
    `),
    ).toBe(false)
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
