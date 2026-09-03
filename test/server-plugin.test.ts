import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createMemoryIdempotencyStorage,
  defineEndpoint,
  defineEndpointRuntime,
  defineEndpointMethodHandlers,
  defineEndpointMethods,
  defineRouteHandler,
} from './internal-runtime'
import type { EndpointRuntime } from './internal-runtime'

vi.mock('#nuxt-endpoints/options', () => ({
  default: {
    dev: true,
    openApi: { enabled: false, path: '/schema', title: 'Test', version: '1.0.0' },
  },
}))
vi.mock('#nuxt-endpoints/runtime', () => ({ default: undefined }))
vi.mock('#nuxt-endpoints/server-route-config', () => ({ default: undefined }))

const { extractEndpoints, initializeEndpointHandlers } =
  await import('../src/runtime/server-plugin')

const disabledOpenApiOptions = {
  dev: true,
  openApi: { enabled: false, path: '/schema', title: 'Test', version: '1.0.0' },
}

describe('idempotency route metadata startup', () => {
  it('attaches route identity even when OpenAPI is disabled', async () => {
    const storage = createMemoryIdempotencyStorage()
    const handler = defineEndpoint({})
      .idempotency({
        fingerprint: () => ({}),
        storage: () => storage,
        scope: () => 'public',
        authorization: 'middleware',
      })
      .handler(() => ({ ok: true }))

    await expect(
      initializeEndpointHandlers([route('/api/items', 'post', handler)], disabledOpenApiOptions),
    ).resolves.toBeUndefined()

    expect(() =>
      handler.__set_endpoint_route__({ method: 'post', routeTemplate: '/api/other-items' }),
    ).toThrow(/multiple route identities/i)
  })

  it('fails startup when one idempotent handler is registered for multiple routes', async () => {
    const storage = createMemoryIdempotencyStorage()
    const handler = defineEndpoint({})
      .idempotency({
        fingerprint: () => ({}),
        storage: () => storage,
        scope: () => 'public',
        authorization: 'middleware',
      })
      .handler(() => ({ ok: true }))

    await expect(
      extractEndpoints([
        route('/api/items', 'post', handler),
        route('/api/other-items', 'post', handler),
      ]),
    ).rejects.toThrow(/multiple route identities/i)
  })

  it('allows one non-idempotent handler to be registered for multiple routes', async () => {
    const handler = defineEndpoint({}).handler(() => ({ ok: true }))

    await expect(
      extractEndpoints([
        route('/api/items', 'post', handler),
        route('/api/other-items', 'post', handler),
      ]),
    ).resolves.toHaveLength(2)
  })

  it('fails startup when an idempotent handler lacks the attachment hook', async () => {
    const handler = Object.assign(() => undefined, {
      __endpoint_contract__: {
        __idempotency_runtime_marker__: { storage: true, scope: true, authorization: true },
        definition: {
          idempotency: { enabled: true as const, headerName: 'Idempotency-Key', required: true },
        },
      },
    })

    await expect(extractEndpoints([route('/api/items', 'post', handler)])).rejects.toThrow(
      /does not expose a route metadata attachment hook/i,
    )
  })

  it('fails startup for hand-written metadata without a runtime policy', async () => {
    const handler = Object.assign(() => undefined, {
      __endpoint_contract__: {
        __idempotency_runtime_marker__: false,
        definition: {
          idempotency: { enabled: true as const, headerName: 'Idempotency-Key', required: true },
        },
      },
      __set_endpoint_route__: vi.fn(),
    })

    await expect(extractEndpoints([route('/api/items', 'post', handler)])).rejects.toThrow(
      /no matching server runtime policy/i,
    )
  })
})

describe('idempotency runtime option resolution at startup', () => {
  it('injects the runtime entry matching the endpoint path and method', async () => {
    const endpointRuntime = { onValidationError: () => undefined }
    const runtime = defineEndpointRuntime({
      routes: { '/api/items': { post: endpointRuntime } },
    } as never)
    const handler = defineEndpoint({}).handler(() => ({ ok: true }))
    const setRuntime = vi.spyOn(handler, '__set_endpoint_runtime__')

    await expect(
      extractEndpoints([route('/api/items', 'post', handler)], runtime),
    ).resolves.toHaveLength(1)
    expect(setRuntime).toHaveBeenCalledWith(
      runtime,
      endpointRuntime,
      {
        method: 'post',
        routeTemplate: '/api/items',
      },
      { responseValidation: true },
    )
  })

  it('resolves the default response-validation mode from Nuxt dev state', async () => {
    const developmentHandler = defineEndpoint({}).handler(() => ({ ok: true }))
    const productionHandler = defineEndpoint({}).handler(() => ({ ok: true }))
    const developmentRuntime = vi.spyOn(developmentHandler, '__set_endpoint_runtime__')
    const productionRuntime = vi.spyOn(productionHandler, '__set_endpoint_runtime__')

    await extractEndpoints(
      [route('/api/development', 'get', developmentHandler)],
      undefined,
      undefined,
      true,
    )
    await extractEndpoints(
      [route('/api/production', 'get', productionHandler)],
      undefined,
      undefined,
      false,
    )

    expect(developmentRuntime).toHaveBeenCalledWith(
      undefined,
      undefined,
      { method: 'get', routeTemplate: '/api/development' },
      { responseValidation: true },
    )
    expect(productionRuntime).toHaveBeenCalledWith(
      undefined,
      undefined,
      { method: 'get', routeTemplate: '/api/production' },
      { responseValidation: false },
    )
  })

  it('lets an explicit response-validation mode override Nuxt dev state', async () => {
    const always = defineEndpointRuntime({ validation: { response: 'always' } })
    const never = defineEndpointRuntime({ validation: { response: 'never' } })
    const alwaysHandler = defineEndpoint({}).handler(() => ({ ok: true }))
    const neverHandler = defineEndpoint({}).handler(() => ({ ok: true }))
    const alwaysRuntime = vi.spyOn(alwaysHandler, '__set_endpoint_runtime__')
    const neverRuntime = vi.spyOn(neverHandler, '__set_endpoint_runtime__')

    await extractEndpoints([route('/api/always', 'get', alwaysHandler)], always, undefined, false)
    await extractEndpoints([route('/api/never', 'get', neverHandler)], never, undefined, true)

    expect(alwaysRuntime.mock.calls[0]?.[3]).toEqual({ responseValidation: true })
    expect(neverRuntime.mock.calls[0]?.[3]).toEqual({ responseValidation: false })
  })

  it('rejects a runtime entry that does not match a discovered endpoint', async () => {
    const runtime = defineEndpointRuntime({
      routes: { '/api/missing': { post: { onValidationError: () => undefined } } },
    })
    const handler = defineEndpoint({}).handler(() => ({ ok: true }))

    await expect(extractEndpoints([route('/api/items', 'post', handler)], runtime)).rejects.toThrow(
      /Runtime entry post \/api\/missing does not match a discovered endpoint route/,
    )
  })

  it('rejects route runtime settings on a handler shared by multiple routes', async () => {
    const runtime = defineEndpointRuntime({
      routes: { '/api/items': { post: { onValidationError: () => undefined } } },
    })
    const handler = defineEndpoint({}).handler(() => ({ ok: true }))

    await expect(
      extractEndpoints(
        [route('/api/items', 'post', handler), route('/api/other-items', 'post', handler)],
        runtime,
      ),
    ).rejects.toThrow(/Route-specific runtime settings cannot be attached to a handler shared by/)
  })

  it('rejects idempotency runtime options on a route that did not enable idempotency', async () => {
    const runtime = defineEndpointRuntime({
      routes: { '/api/items': { post: { idempotency: { fingerprint: () => ({}) } } } },
    })
    const handler = defineEndpoint({}).handler(() => ({ ok: true }))

    await expect(extractEndpoints([route('/api/items', 'post', handler)], runtime)).rejects.toThrow(
      /configures idempotency.*route contract does not enable it/i,
    )
  })

  it('accepts a bodyless idempotent route when its runtime entry supplies a fingerprint', async () => {
    const storage = createMemoryIdempotencyStorage()
    const handler = defineRouteHandler({
      idempotency: { enabled: true, headerName: 'Idempotency-Key', required: true },
      handler: () => ({ ok: true }),
    })
    const runtime = defineEndpointRuntime({
      idempotency: {
        storage: () => storage,
        scope: () => 'public',
        authorization: 'middleware',
      },
      routes: {
        '/api/items': { post: { idempotency: { fingerprint: () => ({}) } } },
      },
    } as never)

    await expect(
      extractEndpoints([route('/api/items', 'post', handler as object)], runtime),
    ).resolves.toHaveLength(1)
  })

  it('gives a bodyless idempotent route an actionable runtime fingerprint error', async () => {
    const storage = createMemoryIdempotencyStorage()
    const handler = defineRouteHandler({
      idempotency: { enabled: true, headerName: 'Idempotency-Key', required: true },
      handler: () => ({ ok: true }),
    })
    const runtime = defineEndpointRuntime({
      idempotency: {
        storage: () => storage,
        scope: () => 'public',
        authorization: 'middleware',
      },
    })

    await expect(
      extractEndpoints([route('/api/items', 'post', handler as object)], runtime),
    ).rejects.toThrow(
      'routes["/api/items"].post.idempotency.fingerprint in server/endpoints/runtime.ts',
    )
  })

  it('injects the central policy (or its absence) into every idempotent handler', async () => {
    const storage = createMemoryIdempotencyStorage()
    const handler = defineEndpoint({})
      .idempotency({
        fingerprint: () => ({}),
        storage: () => storage,
        scope: () => 'public',
        authorization: 'middleware',
      })
      .handler(() => ({ ok: true }))
    const setPolicy = vi.spyOn(handler, '__set_endpoint_runtime__')

    await expect(extractEndpoints([route('/api/items', 'post', handler)])).resolves.toHaveLength(1)
    expect(setPolicy).toHaveBeenCalledOnce()
    expect(setPolicy).toHaveBeenCalledWith(
      undefined,
      undefined,
      { method: 'post', routeTemplate: '/api/items' },
      { responseValidation: true },
    )
  })

  it('resolves runtime options the endpoint omits from the central policy', async () => {
    const storage = createMemoryIdempotencyStorage()
    const runtime: EndpointRuntime = {
      idempotency: {
        storage: () => storage,
        scope: () => 'public',
        authorization: 'middleware',
      },
    }
    const handler = defineEndpoint({})
      .idempotency({
        fingerprint: () => ({}),
        required: true,
      })
      .handler(() => ({ ok: true }))
    const setPolicy = vi.spyOn(handler, '__set_endpoint_runtime__')

    await expect(
      extractEndpoints([route('/api/items', 'post', handler)], runtime),
    ).resolves.toHaveLength(1)
    expect(setPolicy).toHaveBeenCalledOnce()
    expect(setPolicy).toHaveBeenCalledWith(
      runtime,
      undefined,
      { method: 'post', routeTemplate: '/api/items' },
      { responseValidation: true },
    )
  })

  it('fails startup listing the runtime options missing without any central policy', async () => {
    const handler = defineEndpoint({})
      .idempotency({
        fingerprint: () => ({}),
        scope: () => 'public',
      })
      .handler(() => ({ ok: true }))

    await expect(extractEndpoints([route('/api/items', 'post', handler)])).rejects.toThrow(
      '[nuxt-endpoints] Idempotent endpoint post /api/items is missing runtime options: storage, authorization. Provide route overrides or an application idempotency policy in server/endpoints/runtime.ts.',
    )
  })

  it('fails startup when the central policy does not cover the remaining gap', async () => {
    const storage = createMemoryIdempotencyStorage()
    const partialRuntime = { idempotency: { storage: () => storage } } as unknown as EndpointRuntime
    const handler = defineEndpoint({})
      .idempotency({
        fingerprint: () => ({}),
      })
      .handler(() => ({ ok: true }))

    await expect(
      extractEndpoints([route('/api/items', 'post', handler)], partialRuntime),
    ).rejects.toThrow(/missing runtime options: scope, authorization/)
  })
})

describe('OpenAPI document layering from the endpoint runtime file', () => {
  const enabledOpenApiOptions = {
    dev: true,
    openApi: { enabled: true, path: '/schema', title: 'Test', version: '1.0.0' },
  }

  it('merges the runtime file document patch and runs extend last', async () => {
    const endpoint = defineEndpoint({}).handler(() => ({ ok: true }))
    const runtime: EndpointRuntime = {
      openApi: {
        document: { servers: [{ url: 'https://api.example.test' }] },
        extend: (document) => {
          document.security = [{ bearerAuth: [] }]
        },
      },
    }

    const document = await initializeEndpointHandlers(
      [route('/api/items', 'get', endpoint)],
      enabledOpenApiOptions,
      runtime,
    )

    expect(document?.servers).toEqual([{ url: 'https://api.example.test' }])
    expect(document?.security).toEqual([{ bearerAuth: [] }])
    // The patch must not displace what the contracts generated.
    expect(document?.paths['/api/items']?.get?.operationId).toBe('getApiItems')
  })

  it('generates the document unchanged when the runtime file declares no openApi', async () => {
    const endpoint = defineEndpoint({}).handler(() => ({ ok: true }))

    const document = await initializeEndpointHandlers(
      [route('/api/items', 'get', endpoint)],
      enabledOpenApiOptions,
    )

    expect(document?.servers).toBeUndefined()
    expect(document?.paths['/api/items']?.get?.operationId).toBe('getApiItems')
  })

  it('adds matching global, path, and method response contracts to OpenAPI', async () => {
    const endpoint = defineRouteHandler({
      validate: {
        response: {
          200: z.object({ ok: z.literal(true) }),
          401: z.object({ source: z.literal('endpoint') }),
        },
      },
      handler: () => ({ ok: true as const }),
    })

    const document = await initializeEndpointHandlers(
      [route('/api/items', 'get', endpoint as object)],
      enabledOpenApiOptions,
      undefined,
      {
        responses: { 500: z.object({ error: z.literal('internal') }) },
        routes: {
          '/api/**': {
            responses: { 401: z.object({ source: z.literal('application') }) },
            methods: { get: { responses: { 429: z.object({ retryAfter: z.number() }) } } },
          },
        },
      },
    )

    const responses = document?.paths['/api/items']?.get?.responses
    expect(Object.keys(responses ?? {})).toEqual(['200', '401', '429', '500'])
    expect(responses?.[401].content['application/json'].schema).toMatchObject({
      oneOf: [
        { properties: { source: { const: 'endpoint' } } },
        { properties: { source: { const: 'application' } } },
      ],
    })
  })
})

describe('idempotency policy module validation at Nitro startup', () => {
  it('fails startup when the policy file default-exports an invalid shape', async () => {
    vi.resetModules()
    vi.doMock('#nuxt-endpoints/options', () => ({ default: disabledOpenApiOptions }))
    vi.doMock('#nuxt-endpoints/server-handlers', () => ({ handlers: [] }))
    vi.doMock('#nuxt-endpoints/runtime', () => ({
      default: { idempotency: { storage: () => createMemoryIdempotencyStorage() } },
    }))

    const plugin = await import('../src/runtime/server-plugin')
    const runPlugin = plugin.default as unknown as () => Promise<void>
    await expect(runPlugin()).rejects.toThrow(
      '[nuxt-endpoints] The idempotency policy in server/endpoints/runtime.ts needs storage, scope, and authorization.',
    )

    vi.doUnmock('#nuxt-endpoints/options')
    vi.doUnmock('#nuxt-endpoints/server-handlers')
    vi.doUnmock('#nuxt-endpoints/runtime')
    vi.resetModules()
  })
})

describe('server route config validation at Nitro startup', () => {
  it('fails startup when JavaScript exports an invalid config', async () => {
    vi.resetModules()
    vi.doMock('#nuxt-endpoints/options', () => ({ default: disabledOpenApiOptions }))
    vi.doMock('#nuxt-endpoints/server-handlers', () => ({ handlers: [] }))
    vi.doMock('#nuxt-endpoints/runtime', () => ({ default: undefined }))
    vi.doMock('#nuxt-endpoints/server-route-config', () => ({
      default: { routes: { 'api/users': { responses: {} } } },
    }))

    const plugin = await import('../src/runtime/server-plugin')
    const runPlugin = plugin.default as unknown as () => Promise<void>
    await expect(runPlugin()).rejects.toThrow(
      '[nuxt-endpoints] server/routes.config.ts must default-export a valid defineServerRouteConfig({ ... }) value.',
    )

    vi.doUnmock('#nuxt-endpoints/options')
    vi.doUnmock('#nuxt-endpoints/server-handlers')
    vi.doUnmock('#nuxt-endpoints/runtime')
    vi.doUnmock('#nuxt-endpoints/server-route-config')
    vi.resetModules()
  })
})

function route(path: string, method: string, handler: object) {
  return { route: path, method, load: async () => handler }
}

describe('method-group startup handling', () => {
  it('collects every declared method of a defineEndpointMethods() group', async () => {
    const endpoints = defineEndpointMethods({
      get: defineEndpoint({}),
      put: defineEndpoint({}),
    })
    const dispatcher = defineEndpointMethodHandlers(endpoints, {
      get: () => ({ ok: true }),
      put: () => ({ ok: true }),
    })

    const extracted = await extractEndpoints([
      route('/api/multi', 'get', dispatcher),
      route('/api/multi', 'put', dispatcher),
    ])

    expect(extracted.map(({ method }) => method)).toEqual(['get', 'put'])
  })

  it('applies idempotency runtime-gap validation per group member independently', async () => {
    const storage = createMemoryIdempotencyStorage()
    const endpoints = defineEndpointMethods({
      get: defineEndpoint({}),
      post: defineEndpoint({}).idempotency({
        fingerprint: () => ({}),
        storage: () => storage,
        scope: () => 'public',
        authorization: 'middleware',
      }),
    })
    const dispatcher = defineEndpointMethodHandlers(endpoints, {
      get: () => ({ ok: true }),
      post: () => ({ ok: true }),
    })

    await expect(
      extractEndpoints([
        route('/api/multi', 'get', dispatcher),
        route('/api/multi', 'post', dispatcher),
      ]),
    ).resolves.toHaveLength(2)
  })

  it('fails startup when an idempotent group member is missing runtime options', async () => {
    const endpoints = defineEndpointMethods({
      get: defineEndpoint({}),
      post: defineEndpoint({}).idempotency({
        fingerprint: () => ({}),
        scope: () => 'public',
      }),
    })
    const dispatcher = defineEndpointMethodHandlers(endpoints, {
      get: () => ({ ok: true }),
      post: () => ({ ok: true }),
    })

    await expect(
      extractEndpoints([
        route('/api/multi', 'get', dispatcher),
        route('/api/multi', 'post', dispatcher),
      ]),
    ).rejects.toThrow(/missing runtime options: storage, authorization/)
  })

  it('fails startup when a manifest entry declares a method absent from its group', async () => {
    const endpoints = defineEndpointMethods({
      get: defineEndpoint({}),
    })
    const dispatcher = defineEndpointMethodHandlers(endpoints, {
      get: () => ({ ok: true }),
    })

    await expect(extractEndpoints([route('/api/multi', 'delete', dispatcher)])).rejects.toThrow(
      /has no matching member in its multi-method defineRouteHandler\(\)/,
    )
  })
})
