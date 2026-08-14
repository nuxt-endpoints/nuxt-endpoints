import { describe, expect, it, vi } from 'vitest'
import { createMemoryIdempotencyStorage, defineEndpoint } from '../src/runtime'

vi.mock('#nuxt-endpoints/options', () => ({
  default: {
    openApi: { enabled: false, path: '/schema', title: 'Test', version: '1.0.0' },
  },
}))

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
        __idempotency_runtime__: true,
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
        __idempotency_runtime__: false,
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

function route(path: string, method: string, handler: object) {
  return { route: path, method, load: async () => handler }
}
