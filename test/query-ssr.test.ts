import { QueryClient, dehydrate, hydrate } from '@tanstack/vue-query'
import { describe, expect, it, vi } from 'vitest'
import type {
  EndpointFetcherRuntime,
  EndpointQueryKey,
  EndpointQueryOptionsClient,
} from '../src/runtime/tanstack-query'
import { createEndpointQueryOptions } from '../src/runtime/tanstack-query'
import type { StandardSchemaLike } from '../src/runtime'

type Schema<INPUT, OUTPUT = INPUT> = StandardSchemaLike<INPUT, OUTPUT>

type Routes = {
  path: '/api/users/:id'
  method: 'get'
  operation: 'getUser'
  definition: {
    operation: 'getUser'
    params: Schema<{ id: string }>
  }
}

const routesConfig = [{ path: '/api/users/:id', method: 'get', operation: 'getUser' }] as const

function createFetcher(
  dataMock: ReturnType<typeof vi.fn>,
  rawMock: ReturnType<typeof vi.fn> = vi.fn(),
): EndpointFetcherRuntime {
  return Object.assign(dataMock, { raw: rawMock }) as unknown as EndpointFetcherRuntime
}

function createClientOptions(fetcher: EndpointFetcherRuntime) {
  return createEndpointQueryOptions(routesConfig, {
    fetcher,
  }) as unknown as EndpointQueryOptionsClient<Routes>
}

function toPlainOptions(options: { queryKey: unknown; queryFn: unknown }) {
  return {
    queryKey: options.queryKey as EndpointQueryKey,
    queryFn: options.queryFn as (context: { signal?: AbortSignal }) => Promise<unknown>,
  }
}

describe('TanStack Query SSR recipe mechanics', () => {
  describe('request isolation', () => {
    it('dehydrates only the data fetched by each request-scoped QueryClient', async () => {
      const clientA = new QueryClient()
      const clientB = new QueryClient()

      const optionsA = createClientOptions(
        createFetcher(
          vi.fn().mockResolvedValue({
            id: 1,
            name: 'Alice',
          }),
        ),
      )
      const optionsB = createClientOptions(
        createFetcher(
          vi.fn().mockResolvedValue({
            id: 1,
            name: 'Bob',
          }),
        ),
      )

      const request = { params: { id: '1' } }

      await clientA.fetchQuery(toPlainOptions(optionsA.getUser(request)))
      await clientB.fetchQuery(toPlainOptions(optionsB.getUser(request)))

      const key = optionsA.getUser.key(request)
      const dehydratedA = dehydrate(clientA)
      const dehydratedB = dehydrate(clientB)

      const queryA = dehydratedA.queries.find(
        (q) => JSON.stringify(q.queryKey) === JSON.stringify(key),
      )
      const queryB = dehydratedB.queries.find(
        (q) => JSON.stringify(q.queryKey) === JSON.stringify(key),
      )

      expect(queryA?.state.data).toEqual({ id: 1, name: 'Alice' })
      expect(queryB?.state.data).toEqual({ id: 1, name: 'Bob' })

      clientA.clear()
      clientB.clear()
    })
  })

  describe('hydration reuse honoring staleTime', () => {
    // Note: `QueryClient#ensureQueryData` only revalidates when called with an
    // explicit `revalidateIfStale: true`, and even then it kicks off the
    // refetch through a fire-and-forget `prefetchQuery` without awaiting it -
    // it always resolves with the currently cached value. `fetchQuery` is the
    // primitive that actually decides synchronously, from `staleTime`,
    // whether to call the query function or return cached data, which is the
    // behavior `useQuery` relies on after hydration. It is used here instead
    // to make the staleTime contrast observable and awaitable.
    // This is the only proof that the server-generated key and the
    // client-generated key are identical: hydration only reuses cached data
    // when the browser client's query key matches the server's exactly.
    it('reuses hydrated data without refetching when staleTime is non-zero', async () => {
      const serverClient = new QueryClient()
      const serverOptions = createClientOptions(
        createFetcher(vi.fn().mockResolvedValue({ id: 1, name: 'Alice' })),
      )
      const request = { params: { id: '1' } }

      await serverClient.fetchQuery(toPlainOptions(serverOptions.getUser(request)))
      const dehydratedState = dehydrate(serverClient)
      serverClient.clear()

      const browserFetcherData = vi.fn().mockResolvedValue({ id: 1, name: 'Stale refetch' })
      const browserOptions = createClientOptions(createFetcher(browserFetcherData))
      const browserClient = new QueryClient({
        defaultOptions: { queries: { staleTime: 60_000 } },
      })

      hydrate(browserClient, dehydratedState)
      const data = await browserClient.fetchQuery(toPlainOptions(browserOptions.getUser(request)))

      expect(data).toEqual({ id: 1, name: 'Alice' })
      expect(browserFetcherData).not.toHaveBeenCalled()

      browserClient.clear()
    })
  })

  describe('serializability round-trip', () => {
    it('reproduces result-mode { status, ok, body } through a JSON round-trip', async () => {
      const serverClient = new QueryClient()
      const rawMock = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers({ 'set-cookie': 'session=secret' }),
        _data: { id: 1, name: 'Alice' },
      })
      const serverOptions = createClientOptions(createFetcher(vi.fn(), rawMock))
      const request = { params: { id: '1' } }

      const options = serverOptions.getUser.result(request)
      await serverClient.fetchQuery(toPlainOptions(options))

      const serialized = JSON.parse(JSON.stringify(dehydrate(serverClient)))

      const newClient = new QueryClient()
      hydrate(newClient, serialized)

      const key = serverOptions.getUser.result.key(request)
      expect(newClient.getQueryData(key)).toEqual({
        status: 200,
        ok: true,
        body: { id: 1, name: 'Alice' },
      })

      serverClient.clear()
      newClient.clear()
    })
  })
})
