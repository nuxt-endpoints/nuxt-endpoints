import { describe, expect, it, vi } from 'vitest'
import {
  createMemoryIdempotencyStorage,
  defineEndpoint,
  defineEndpointMethodHandlers,
  defineEndpointMethods,
} from '../src/runtime'
import type { EndpointIdempotencyPolicy } from '../src/runtime'

vi.mock('#nuxt-endpoints/options', () => ({
  default: {
    openApi: { enabled: false, path: '/schema', title: 'Test', version: '1.0.0' },
  },
}))
vi.mock('#nuxt-endpoints/idempotency-policy', () => ({ default: undefined }))

const { extractEndpoints, initializeEndpointHandlers } =
  await import('../src/runtime/server-plugin')

const disabledOpenApiOptions = {
  openApi: { enabled: false, path: '/schema', title: 'Test', version: '1.0.0' },
}

describe('idempotency route metadata startup', () => {
  it('attaches route identity even when OpenAPI is disabled', async () => {
    const storage = createMemoryIdempotencyStorage()
    const handler = defineEndpoint({})
      .idempotency({
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
  it('injects the central policy (or its absence) into every idempotent handler', async () => {
    const storage = createMemoryIdempotencyStorage()
    const handler = defineEndpoint({})
      .idempotency({ storage: () => storage, scope: () => 'public', authorization: 'middleware' })
      .handler(() => ({ ok: true }))
    const setPolicy = vi.spyOn(handler, '__set_idempotency_policy__')

    await expect(extractEndpoints([route('/api/items', 'post', handler)])).resolves.toHaveLength(1)
    expect(setPolicy).toHaveBeenCalledOnce()
    expect(setPolicy).toHaveBeenCalledWith(undefined)
  })

  it('resolves runtime options the endpoint omits from the central policy', async () => {
    const storage = createMemoryIdempotencyStorage()
    const policy: EndpointIdempotencyPolicy = {
      storage: () => storage,
      scope: () => 'public',
      authorization: 'middleware',
    }
    const handler = defineEndpoint({})
      .idempotency({ required: true })
      .handler(() => ({ ok: true }))
    const setPolicy = vi.spyOn(handler, '__set_idempotency_policy__')

    await expect(
      extractEndpoints([route('/api/items', 'post', handler)], policy),
    ).resolves.toHaveLength(1)
    expect(setPolicy).toHaveBeenCalledOnce()
    expect(setPolicy).toHaveBeenCalledWith(policy)
  })

  it('fails startup listing the runtime options missing without any central policy', async () => {
    const handler = defineEndpoint({})
      .idempotency({ scope: () => 'public' })
      .handler(() => ({ ok: true }))

    await expect(extractEndpoints([route('/api/items', 'post', handler)])).rejects.toThrow(
      '[nuxt-endpoints] Idempotent endpoint post /api/items is missing runtime options: storage, authorization. Provide them in .idempotency() or define a central policy in server/endpoints/idempotency.ts.',
    )
  })

  it('fails startup when the central policy does not cover the remaining gap', async () => {
    const storage = createMemoryIdempotencyStorage()
    const partialPolicy = { storage: () => storage } as unknown as EndpointIdempotencyPolicy
    const handler = defineEndpoint({})
      .idempotency({})
      .handler(() => ({ ok: true }))

    await expect(
      extractEndpoints([route('/api/items', 'post', handler)], partialPolicy),
    ).rejects.toThrow(/missing runtime options: scope, authorization/)
  })
})

describe('idempotency policy module validation at Nitro startup', () => {
  it('fails startup when the policy file default-exports an invalid shape', async () => {
    vi.resetModules()
    vi.doMock('#nuxt-endpoints/options', () => ({ default: disabledOpenApiOptions }))
    vi.doMock('#nuxt-endpoints/server-handlers', () => ({ handlers: [] }))
    vi.doMock('#nuxt-endpoints/idempotency-policy', () => ({
      default: { storage: () => createMemoryIdempotencyStorage() },
    }))

    const plugin = await import('../src/runtime/server-plugin')
    const runPlugin = plugin.default as unknown as () => Promise<void>
    await expect(runPlugin()).rejects.toThrow(
      '[nuxt-endpoints] server/endpoints/idempotency.ts must default-export defineIdempotencyPolicy({ storage, scope, authorization }).',
    )

    vi.doUnmock('#nuxt-endpoints/options')
    vi.doUnmock('#nuxt-endpoints/server-handlers')
    vi.doUnmock('#nuxt-endpoints/idempotency-policy')
    vi.resetModules()
  })
})

function route(path: string, method: string, handler: object) {
  return { route: path, method, load: async () => handler }
}

describe('method-group startup handling', () => {
  it('collects every declared method of a defineEndpointMethods() group', async () => {
    const endpoints = defineEndpointMethods({
      get: defineEndpoint({ operation: 'getMulti' }),
      put: defineEndpoint({ operation: 'putMulti' }),
    })
    const dispatcher = defineEndpointMethodHandlers(endpoints, {
      get: () => ({ ok: true }),
      put: () => ({ ok: true }),
    })

    const extracted = await extractEndpoints([
      route('/api/multi', 'get', dispatcher),
      route('/api/multi', 'put', dispatcher),
    ])

    expect(extracted).toHaveLength(2)
    expect(extracted.map((endpoint) => endpoint.definition.operation)).toEqual([
      'getMulti',
      'putMulti',
    ])
  })

  it('applies idempotency runtime-gap validation per group member independently', async () => {
    const storage = createMemoryIdempotencyStorage()
    const endpoints = defineEndpointMethods({
      get: defineEndpoint({ operation: 'getMulti' }),
      post: defineEndpoint({ operation: 'postMulti' }).idempotency({
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
      get: defineEndpoint({ operation: 'getMulti' }),
      post: defineEndpoint({ operation: 'postMulti' }).idempotency({ scope: () => 'public' }),
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
      get: defineEndpoint({ operation: 'getMulti' }),
    })
    const dispatcher = defineEndpointMethodHandlers(endpoints, {
      get: () => ({ ok: true }),
    })

    await expect(extractEndpoints([route('/api/multi', 'delete', dispatcher)])).rejects.toThrow(
      /has no matching method in its defineEndpointMethods\(\) group/,
    )
  })
})
