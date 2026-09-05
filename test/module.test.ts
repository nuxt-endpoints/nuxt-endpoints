import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Nuxt } from '@nuxt/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  assertOpenApiRoutesDoNotOverlap,
  composeHandlers,
  findUnsupportedRouteTemplateSyntax,
  indexRouteContracts,
  resolveConventionPath,
  resolveExplicitConventionPath,
  resolveModuleOptions,
} from '../src/module'
import { formOf } from '../src/runtime'

describe('Nitro route contract provider', () => {
  it('projects a declared endpoint name into generated client metadata', async () => {
    const handler = {
      handler: '/project/server/api/users/[id].get.ts',
      route: '/api/users/:id',
      method: 'get',
      middleware: false,
    }
    const contracts = indexRouteContracts([{ ...handler, contract: { name: 'getUser' } }])

    await expect(composeHandlers([handler], contracts)).resolves.toMatchObject([
      { route: '/api/users/:id', method: 'get', name: 'getUser' },
    ])
  })

  it('rejects duplicate and unsafe endpoint names at build time', async () => {
    const handlers = [
      {
        handler: '/project/server/api/users.get.ts',
        route: '/api/users',
        method: 'get',
        middleware: false,
      },
      {
        handler: '/project/server/api/accounts.get.ts',
        route: '/api/accounts',
        method: 'get',
        middleware: false,
      },
    ]
    const duplicateContracts = indexRouteContracts(
      handlers.map((handler) => ({ ...handler, contract: { name: 'getUser' } })),
    )
    await expect(composeHandlers(handlers, duplicateContracts)).rejects.toThrow(
      /Duplicate endpoint name `getUser`/,
    )

    const unsafeContracts = indexRouteContracts([
      { ...handlers[0]!, contract: { name: 'not-valid' } },
    ])
    await expect(composeHandlers([handlers[0]!], unsafeContracts)).rejects.toThrow(
      /valid JavaScript identifier/,
    )
  })

  it('projects cursor pagination capability into generated client metadata', async () => {
    const handler = {
      handler: '/project/server/api/articles.get.ts',
      route: '/api/articles',
      method: 'get',
      middleware: false,
    }
    const contracts = indexRouteContracts([
      {
        ...handler,
        contract: {
          pagination: { kind: 'cursor', item: z.object({ id: z.number() }) },
          responses: {},
        },
      },
    ])

    await expect(composeHandlers([handler], contracts)).resolves.toMatchObject([
      {
        route: '/api/articles',
        method: 'get',
        pagination: {
          kind: 'cursor',
          status: 200,
          cursor: 'cursor',
          limit: 'limit',
          items: 'items',
          next: 'nextCursor',
        },
      },
    ])
  })

  it('rejects cursor pagination on a non-GET route at build time', async () => {
    const handler = {
      handler: '/project/server/api/articles.post.ts',
      route: '/api/articles',
      method: 'post',
      middleware: false,
    }
    const contracts = indexRouteContracts([
      {
        ...handler,
        contract: {
          pagination: { kind: 'cursor', item: z.object({ id: z.number() }) },
          responses: {},
        },
      },
    ])

    await expect(composeHandlers([handler], contracts)).rejects.toThrow(
      /Cursor pagination is only supported on GET routes/,
    )
  })

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

  it('resolves a form declaration into field attributes at build time', async () => {
    // Derived here rather than in the browser, so the generated client carries
    // plain HTML attributes and no schema object ever reaches it.
    const handler = {
      handler: '/project/server/api/todos.post.ts',
      route: '/api/todos',
      method: 'post',
      middleware: false,
    }
    const Todo = z.object({ title: z.string().min(1), done: z.boolean() })
    const contracts = indexRouteContracts([
      {
        ...handler,
        contract: {
          form: { action: '/todos/new', redirect: '/todos/{id}' },
          body: {
            'application/json': Todo,
            'application/x-www-form-urlencoded': formOf(Todo),
          },
          responses: { 201: z.object({ id: z.number() }) },
        },
      },
    ])

    await expect(composeHandlers([handler], contracts)).resolves.toMatchObject([
      {
        route: '/api/todos',
        method: 'post',
        form: {
          action: '/todos/new',
          method: 'post',
          redirect: '/todos/{id}',
          enctype: 'application/x-www-form-urlencoded',
          fields: {
            title: { name: 'title', required: true, minlength: 1 },
            done: { name: 'done' },
          },
        },
      },
    ])
  })

  it('reports the form.action migration for JavaScript contracts using form.from', () => {
    expect(() =>
      indexRouteContracts([
        {
          handler: '/project/server/api/search.get.ts',
          route: '/api/search',
          method: 'get',
          middleware: false,
          contract: {
            form: { from: '/search', method: 'get' },
            query: z.object({ q: z.string().optional() }),
          },
        },
      ] as never),
    ).toThrow(/form.from was renamed to form.action/)
  })

  it('rejects a form projection on a route with a path parameter', async () => {
    // The bridge forwards the submission to this route template verbatim, and a
    // native form carries nothing that would fill `:id` in.
    const handler = {
      handler: '/project/server/api/todos/[id].put.ts',
      route: '/api/todos/:id',
      method: 'put',
      middleware: false,
    }
    const Todo = z.object({ title: z.string().min(1) })
    const contracts = indexRouteContracts([
      {
        ...handler,
        contract: {
          form: { action: '/todos/edit' },
          body: { 'application/x-www-form-urlencoded': formOf(Todo) },
          responses: {},
        },
      },
    ])

    await expect(composeHandlers([handler], contracts)).rejects.toThrow(
      /cannot fill in a path parameter/,
    )
  })

  it('projects a GET route from its query contract', async () => {
    const handler = {
      handler: '/project/server/api/search.get.ts',
      route: '/api/search',
      method: 'get',
      middleware: false,
    }
    const contracts = indexRouteContracts([
      {
        ...handler,
        contract: {
          form: { action: '/search', method: 'get' },
          query: z.object({ term: z.string().min(1), page: z.coerce.number().optional() }),
          responses: { 200: z.object({ items: z.array(z.string()) }) },
        },
      },
    ])

    await expect(composeHandlers([handler], contracts)).resolves.toMatchObject([
      {
        route: '/api/search',
        method: 'get',
        form: {
          action: '/search',
          method: 'get',
          enctype: 'application/x-www-form-urlencoded',
          fields: {
            term: { name: 'term', required: true, minlength: 1 },
            page: { name: 'page' },
          },
        },
      },
    ])
  })

  it('rejects an implicit PUT/PATCH/DELETE method override', async () => {
    const handler = {
      handler: '/project/server/api/profile.put.ts',
      route: '/api/profile',
      method: 'put',
      middleware: false,
    }
    const contracts = indexRouteContracts([
      {
        ...handler,
        contract: {
          form: { action: '/profile/edit' },
          body: {
            'application/x-www-form-urlencoded': formOf(z.object({ name: z.string() })),
          },
          responses: { 200: z.object({ name: z.string() }) },
        },
      },
    ])

    await expect(composeHandlers([handler], contracts)).rejects.toThrow(
      /form.method: 'post'.*endpoint method is PUT.*not emulated over POST/s,
    )
  })

  it('rejects a GET form with no query contract', () => {
    const handler = {
      handler: '/project/server/api/search.get.ts',
      route: '/api/search',
      method: 'get',
      middleware: false,
    }

    expect(() =>
      indexRouteContracts([
        {
          ...handler,
          contract: { form: { action: '/search', method: 'get' }, responses: {} },
        },
      ]),
    ).toThrow(/GET form needs `validate.query`/)
  })

  it('rejects a redirect placeholder absent from a successful response', () => {
    const handler = {
      handler: '/project/server/api/todos.post.ts',
      route: '/api/todos',
      method: 'post',
      middleware: false,
    }

    expect(() =>
      indexRouteContracts([
        {
          ...handler,
          contract: {
            form: { action: '/todos/new', redirect: '/todos/{id}' },
            body: {
              'application/x-www-form-urlencoded': formOf(z.object({ title: z.string() })),
            },
            responses: { 201: z.object({ slug: z.string() }) },
          },
        },
      ]),
    ).toThrow(/cannot resolve id from successful response 201/)
  })

  it('rejects a form declaration a browser could never satisfy', () => {
    const handler = {
      handler: '/project/server/api/todos.post.ts',
      route: '/api/todos',
      method: 'post',
      middleware: false,
    }
    // The declaration is rejected while contracts are indexed, which is the
    // first point that sees it - before any handler entry exists to carry it.
    expect(() =>
      indexRouteContracts([
        {
          ...handler,
          // JSON only: a native form cannot send it.
          contract: {
            form: { action: '/todos/new' },
            body: z.object({ title: z.string() }),
            responses: {},
          },
        },
      ]),
    ).toThrow(/must accept an encoding a browser can submit/)
  })

  it('rejects a form page path that is not absolute', () => {
    const handler = {
      handler: '/project/server/api/todos.post.ts',
      route: '/api/todos',
      method: 'post',
      middleware: false,
    }
    const Todo = z.object({ title: z.string() })

    expect(() =>
      indexRouteContracts([
        {
          ...handler,
          contract: {
            form: { action: 'todos/new' },
            body: { 'application/x-www-form-urlencoded': formOf(Todo) },
            responses: {},
          },
        },
      ]),
    ).toThrow(/must be an absolute page path/)
  })

  it.each(['/search?scope=all', '/search#results'])(
    'rejects query strings and fragments in form.action: %s',
    (action) => {
      const handler = {
        handler: '/project/server/api/search.get.ts',
        route: '/api/search',
        method: 'get',
        middleware: false,
      }

      expect(() =>
        indexRouteContracts([
          {
            ...handler,
            contract: {
              form: { action, method: 'get' },
              query: z.object({ q: z.string().optional() }),
              responses: { 200: z.object({ items: z.array(z.string()) }) },
            },
          },
        ]),
      ).toThrow(/page pathname without a query string or fragment/)
    },
  )

  // These rules are stated at the type level too
  // (src/runtime/form-projection.ts, test/types/form-projection.test-d.ts).
  // They are re-checked here because a cast erases the type, and a rule that
  // only holds when nobody casts is not a rule.
  describe('a contract a native form could not produce a request for', () => {
    const Todo = z.object({ title: z.string() })
    const handler = {
      handler: '/project/server/api/todos.post.ts',
      route: '/api/todos',
      method: 'post',
      middleware: false,
    }
    const index = (contract: Record<string, unknown>) => () =>
      indexRouteContracts([
        {
          ...handler,
          contract: {
            form: { action: '/todos/new' },
            body: { 'application/x-www-form-urlencoded': formOf(Todo) },
            responses: {},
            ...contract,
          },
        },
      ])

    it('rejects an idempotent route, which needs a header a form cannot send', () => {
      expect(
        index({ idempotency: { enabled: true, headerName: 'Idempotency-Key', required: true } }),
      ).toThrow(/cannot send an Idempotency-Key header/)
    })

    it('rejects a required request header', () => {
      expect(index({ headers: z.object({ 'x-tenant': z.string() }) })).toThrow(
        /cannot send request headers.*Required: x-tenant/s,
      )
    })

    it('rejects a required query parameter', () => {
      expect(index({ query: z.object({ list: z.string() }) })).toThrow(
        /reaches the endpoint with no query string.*Required: list/s,
      )
    })

    it('allows a header or query declaration that requires nothing', () => {
      expect(
        index({
          headers: z.object({ 'accept-language': z.string().optional() }),
          query: z.object({ page: z.string().optional() }),
        }),
      ).not.toThrow()
    })

    it('allows a union whose branches do not agree that a member is required', () => {
      // One branch requires `a` and the other does not, so a submission that
      // sends nothing is still valid.
      expect(index({ headers: z.union([z.object({ a: z.string() }), z.object({})]) })).not.toThrow()
    })

    it('rejects a schema it cannot prove requires nothing', () => {
      // Silently waving an uninspectable declaration through would ship a form
      // whose fallback 400s on every submission, which is the failure this
      // prevents. Stricter than the type-level rule on purpose: the type reads
      // the declared input, this reads the derived JSON Schema, and only the
      // build can tell that it derived nothing to read.
      expect(index({ headers: z.record(z.string(), z.string()) })).toThrow(
        /could not be inspected to prove it requires none/,
      )
    })
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
