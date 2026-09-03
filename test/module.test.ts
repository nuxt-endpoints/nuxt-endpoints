import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Nuxt } from '@nuxt/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertOpenApiRoutesDoNotOverlap,
  composeHandlers,
  findUnsupportedRouteTemplateSyntax,
  indexRouteContracts,
  resolveConventionPath,
  resolveExplicitConventionPath,
  resolveModuleOptions,
} from '../src/module'

describe('Nitro route contract provider', () => {
  it('composes handlers exclusively from provider contracts', async () => {
    const handler = {
      handler: '/project/server/api/users.get.ts',
      route: '/api/users',
      method: 'get',
      middleware: false,
    }
    const contracts = indexRouteContracts([
      {
        ...handler,
        contract: { responses: {} },
      },
    ])

    await expect(composeHandlers([handler], contracts)).resolves.toMatchObject([
      { route: '/api/users', method: 'get' },
    ])
  })
})

describe('Nitro built-in OpenAPI overlap', () => {
  const nitro = (options: Record<string, unknown>) =>
    ({ options }) as unknown as Parameters<typeof assertOpenApiRoutesDoNotOverlap>[0]

  it("says nothing when Nitro's OpenAPI is disabled", () => {
    const warn = vi.fn()

    assertOpenApiRoutesDoNotOverlap(nitro({ dev: true }), '/_endpoints/schema', warn)

    expect(warn).not.toHaveBeenCalled()
  })

  it('says nothing when it is enabled but not registered for this build', () => {
    const warn = vi.fn()

    assertOpenApiRoutesDoNotOverlap(
      nitro({ dev: false, experimental: { openAPI: true } }),
      '/_endpoints/schema',
      warn,
    )

    expect(warn).not.toHaveBeenCalled()
  })

  it('warns that two documents are served, naming both routes', () => {
    const warn = vi.fn()

    assertOpenApiRoutesDoNotOverlap(
      nitro({ dev: true, experimental: { openAPI: true } }),
      '/_endpoints/schema',
      warn,
    )

    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]![0]).toContain('/_openapi.json')
    expect(warn.mock.calls[0]![0]).toContain('/_endpoints/schema')
  })

  it('honors a configured Nitro route and a production mode', () => {
    const warn = vi.fn()

    assertOpenApiRoutesDoNotOverlap(
      nitro({
        dev: false,
        experimental: { openAPI: true },
        openAPI: { route: '/docs/openapi.json', production: 'runtime' },
      }),
      '/_endpoints/schema',
      warn,
    )

    expect(warn.mock.calls[0]![0]).toContain('/docs/openapi.json')
  })

  it('compares the two routes the way h3 registers them', () => {
    const warn = vi.fn()

    expect(() =>
      assertOpenApiRoutesDoNotOverlap(
        nitro({ dev: true, experimental: { openAPI: true }, openAPI: { route: '/schema/' } }),
        'schema',
        warn,
      ),
    ).toThrow(/same route this module serves its own document on/)
  })

  it('fails the build when both documents claim the same route', () => {
    const warn = vi.fn()

    expect(() =>
      assertOpenApiRoutesDoNotOverlap(
        nitro({ dev: true, experimental: { openAPI: true }, openAPI: { route: '/schema' } }),
        '/schema',
        warn,
      ),
    ).toThrow(/same route this module serves its own document on/)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('media response detection', () => {
  it('reports mediaResponse: true for a carrier declaring a media response via responses', () => {
    const detection = indexRouteContracts([
      {
        handler: '/server/api/export.get.ts',
        method: 'get',
        route: '/api/export',
        contract: {
          responses: {
            200: { media: 'text/csv' },
            404: { message: 'not used at build time' } as never,
          },
        },
      },
    ]).get('/server/api/export.get.ts\0get')

    expect(detection).toEqual({ mediaResponse: true })
  })

  it('reports mediaResponse: true for a carrier declaring a media response via a bare response', () => {
    const detection = indexRouteContracts([
      {
        handler: '/server/api/export.get.ts',
        method: 'get',
        route: '/api/export',
        contract: { responses: { 200: { media: 'text/csv' } } },
      },
    ]).get('/server/api/export.get.ts\0get')

    expect(detection).toEqual({ mediaResponse: true })
  })

  it('reports no stream key when the carrier declares only validated responses', () => {
    const detection = indexRouteContracts([
      {
        handler: '/server/api/users.get.ts',
        method: 'get',
        route: '/api/users',
        contract: {
          responses: {
            200: { message: 'validated' } as never,
          },
        },
      },
    ]).get('/server/api/users.get.ts\0get')

    expect(detection).toEqual({})
  })
})

describe('findUnsupportedRouteTemplateSyntax', () => {
  it('reports a named catch-all segment', () => {
    expect(findUnsupportedRouteTemplateSyntax('/api/files/**:path')).toBe('catch-all')
  })

  it('reports a bare catch-all segment', () => {
    expect(findUnsupportedRouteTemplateSyntax('/api/files/**')).toBe('catch-all')
  })

  it('reports a trailing optional parameter segment', () => {
    expect(findUnsupportedRouteTemplateSyntax('/api/users/:id?')).toBe('optional-parameter')
  })

  it('reports an optional parameter segment in the middle of the route', () => {
    expect(findUnsupportedRouteTemplateSyntax('/api/users/:id?/more')).toBe('optional-parameter')
  })

  it('passes an ordinary dynamic route', () => {
    expect(findUnsupportedRouteTemplateSyntax('/api/users/:id')).toBeUndefined()
  })
})

describe('resolveModuleOptions', () => {
  it('carries Nuxt dev state into the server runtime options', () => {
    expect(resolveModuleOptions({}, true).dev).toBe(true)
    expect(resolveModuleOptions({}, false).dev).toBe(false)
  })

  it('enables OpenAPI by default only in dev mode', () => {
    expect(resolveModuleOptions({}, true).openApi).toEqual({
      enabled: true,
      path: '/_endpoints/schema',
      title: 'Nuxt Endpoints API',
      version: '0.1.0',
    })
    expect(resolveModuleOptions({}, false).openApi.enabled).toBe(false)
  })

  it('disables OpenAPI when openApi is false, regardless of dev mode', () => {
    expect(resolveModuleOptions({ openApi: false }, true).openApi.enabled).toBe(false)
  })

  it('enables OpenAPI when openApi is true, regardless of dev mode', () => {
    expect(resolveModuleOptions({ openApi: true }, false).openApi.enabled).toBe(true)
  })

  it('merges an OpenAPI options object over the defaults and normalizes a relative path', () => {
    const resolved = resolveModuleOptions(
      { openApi: { path: 'custom/schema', title: 'Custom API' } },
      false,
    )

    expect(resolved.openApi).toEqual({
      enabled: false,
      path: '/custom/schema',
      title: 'Custom API',
      version: '0.1.0',
    })
  })

  it('resolves client defaults when no client options are provided', () => {
    expect(resolveModuleOptions({}, false).client).toEqual({
      raw: true,
    })
  })

  it('rejects the removed TanStack Query setup option at runtime', () => {
    expect(() =>
      resolveModuleOptions({ client: { query: { setup: 'auto' } } } as never, false),
    ).toThrow(/client\.query was removed.*Pinia Colada/)
  })
})

describe('idempotency policy path resolution', () => {
  const temporaryDirectories: string[] = []

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function createTemporaryDir(): string {
    const directory = mkdtempSync(join(tmpdir(), 'nuxt-endpoints-policy-'))
    temporaryDirectories.push(directory)
    return directory
  }

  describe('resolveConventionPath', () => {
    it('returns undefined when no scanDir has an idempotency policy file', async () => {
      const scanDir = createTemporaryDir()

      await expect(
        resolveConventionPath(scanDir, [scanDir], 'endpoints/idempotency'),
      ).resolves.toBeUndefined()
    })

    it('returns the first scanDir match and ignores later matches', async () => {
      const firstScanDir = createTemporaryDir()
      const secondScanDir = createTemporaryDir()
      await mkdir(join(firstScanDir, 'endpoints'), { recursive: true })
      await writeFile(join(firstScanDir, 'endpoints/idempotency.ts'), 'export default {}\n')
      await mkdir(join(secondScanDir, 'endpoints'), { recursive: true })
      await writeFile(join(secondScanDir, 'endpoints/idempotency.ts'), 'export default {}\n')

      const resolved = await resolveConventionPath(
        firstScanDir,
        [firstScanDir, secondScanDir],
        'endpoints/idempotency',
      )

      expect(resolved).toBe(join(firstScanDir, 'endpoints/idempotency.ts'))
    })

    it('skips scanDirs without a match and resolves the first one that has it', async () => {
      const emptyScanDir = createTemporaryDir()
      const matchingScanDir = createTemporaryDir()
      await mkdir(join(matchingScanDir, 'endpoints'), { recursive: true })
      await writeFile(join(matchingScanDir, 'endpoints/idempotency.ts'), 'export default {}\n')

      const resolved = await resolveConventionPath(
        emptyScanDir,
        [emptyScanDir, matchingScanDir],
        'endpoints/idempotency',
      )

      expect(resolved).toBe(join(matchingScanDir, 'endpoints/idempotency.ts'))
    })
  })

  describe('resolveExplicitConventionPath', () => {
    it('throws when the configured policy path has no matching file', async () => {
      const rootDir = createTemporaryDir()
      const nuxt = { options: { rootDir } } as Nuxt

      await expect(
        resolveExplicitConventionPath(
          nuxt,
          'server/endpoints/missing-policy',
          'endpoints.idempotency.policy',
        ),
      ).rejects.toThrow(/no matching file was found/i)
    })

    it('resolves the configured policy path when a matching file exists', async () => {
      const rootDir = createTemporaryDir()
      await mkdir(join(rootDir, 'server/endpoints'), { recursive: true })
      await writeFile(join(rootDir, 'server/endpoints/idempotency.ts'), 'export default {}\n')
      const nuxt = { options: { rootDir } } as Nuxt

      const resolved = await resolveExplicitConventionPath(
        nuxt,
        'server/endpoints/idempotency',
        'endpoints.idempotency.policy',
      )

      expect(resolved).toBe(join(rootDir, 'server/endpoints/idempotency.ts'))
    })
  })
})
