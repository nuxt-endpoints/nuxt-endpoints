import { QueryClient } from '@tanstack/vue-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  EndpointFetcherRuntime,
  EndpointInfiniteQueryOptionsClient,
  EndpointQueryKey,
  EndpointQueryOptionsClient,
  EndpointQueryOptionsObject,
} from '../src/runtime/query'
import {
  createEndpointInfiniteQueryOptions,
  createEndpointQueryOptions,
} from '../src/runtime/query'
import type { StandardSchemaLike } from '../src/runtime'

const fetchMock = vi.fn()
const fetchRawMock = vi.fn()

type Schema<INPUT, OUTPUT = INPUT> = StandardSchemaLike<INPUT, OUTPUT>

type SearchUsersPage = { items: string[]; nextCursor?: string }
type SearchItemsPage = { items: string[] }

type Routes =
  | {
      path: '/api/users/search'
      method: 'get'
      operation: 'searchUsers'
      definition: {
        operation: 'searchUsers'
        query: Schema<{ cursor?: string; term?: string }>
        response: Schema<SearchUsersPage>
      }
    }
  | {
      path: '/api/items/search'
      method: 'get'
      operation: 'searchItems'
      definition: {
        operation: 'searchItems'
        query: Schema<{ weirdCursorName?: string }>
        response: Schema<SearchItemsPage>
      }
    }
  | {
      path: '/api/health'
      method: 'get'
      operation: 'health'
      definition: {
        operation: 'health'
        response: Schema<{ ok: true }>
      }
    }
  | {
      path: '/api/users'
      method: 'post'
      operation: 'createUser'
      definition: {
        operation: 'createUser'
        body: Schema<{ name: string }>
      }
    }
  | {
      path: '/api/reports'
      method: 'get'
      definition: {}
    }
  | {
      path: '/api/then'
      method: 'get'
      operation: 'then'
      definition: {
        operation: 'then'
      }
    }
  | {
      path: '/api/retry-search'
      method: 'get'
      operation: 'retrySearch'
      definition: {
        operation: 'retrySearch'
        idempotency: {
          enabled: true
          headerName: 'Idempotency-Key'
          required: true
        }
        response: Schema<SearchItemsPage>
      }
    }

const routesConfig = [
  { path: '/api/users/search', method: 'get', operation: 'searchUsers' },
  { path: '/api/items/search', method: 'get', operation: 'searchItems' },
  { path: '/api/health', method: 'get', operation: 'health' },
  { path: '/api/users', method: 'post', operation: 'createUser' },
  { path: '/api/reports', method: 'get' },
  { path: '/api/then', method: 'get', operation: 'then' },
  {
    path: '/api/retry-search',
    method: 'get',
    operation: 'retrySearch',
    idempotency: { headerName: 'Idempotency-Key', required: true },
  },
] as const

function createFetcher(
  dataMock: ReturnType<typeof vi.fn>,
  rawMock: ReturnType<typeof vi.fn> = vi.fn(),
): EndpointFetcherRuntime {
  return Object.assign(dataMock, { raw: rawMock }) as unknown as EndpointFetcherRuntime
}

function toPlainOptions<DATA>(options: EndpointQueryOptionsObject<DATA>) {
  return {
    queryKey: options.queryKey as EndpointQueryKey,
    queryFn: options.queryFn,
  }
}

describe('TanStack Query infinite adapter', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchRawMock.mockReset()
    vi.stubGlobal('$fetch', Object.assign(fetchMock, { raw: fetchRawMock }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const infiniteOptions = createEndpointInfiniteQueryOptions(
    routesConfig,
  ) as unknown as EndpointInfiniteQueryOptionsClient<Routes>

  describe('classification', () => {
    it('exposes GET/HEAD operations on the infinite query client', () => {
      expect(Object.hasOwn(infiniteOptions, 'searchUsers')).toBe(true)
      expect(Object.hasOwn(infiniteOptions, 'searchItems')).toBe(true)
      expect(Object.hasOwn(infiniteOptions, 'health')).toBe(true)
    })

    it('excludes mutation (non GET/HEAD) operations', () => {
      expect(Object.hasOwn(infiniteOptions, 'createUser')).toBe(false)
    })

    it('skips routes without an operation', () => {
      expect(Object.hasOwn(infiniteOptions, 'undefined')).toBe(false)
      expect(Object.keys(infiniteOptions).sort()).toEqual(
        ['searchUsers', 'searchItems', 'health', 'retrySearch'].sort(),
      )
    })

    it('skips reserved operation names', () => {
      expect(Object.hasOwn(infiniteOptions, 'then')).toBe(false)
    })
  })

  describe('keys', () => {
    it('matches the exact prefix/full/result key shapes', () => {
      expect(infiniteOptions.searchUsers.key()).toEqual([
        'nuxt-endpoints',
        'v1',
        'searchUsers',
        'infinite',
      ])
      expect(infiniteOptions.searchUsers.result.key()).toEqual([
        'nuxt-endpoints',
        'v1',
        'searchUsers',
        'infinite',
        'result',
      ])

      const config = {
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { cursor: pageParam, term: 'x' } }),
        getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
      }
      const resultConfig = {
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { cursor: pageParam, term: 'x' } }),
        getNextPageParam: (page: { status: 200; ok: true; body: SearchUsersPage }) =>
          page.body.nextCursor,
      }

      expect(infiniteOptions.searchUsers.key(config)).toEqual([
        'nuxt-endpoints',
        'v1',
        'searchUsers',
        'infinite',
        { query: { cursor: 'c0', term: 'x' } },
      ])
      expect(infiniteOptions.searchUsers.result.key(resultConfig)).toEqual([
        'nuxt-endpoints',
        'v1',
        'searchUsers',
        'infinite',
        'result',
        { query: { cursor: 'c0', term: 'x' } },
      ])
      expect(infiniteOptions.searchUsers(config).queryKey).toEqual(
        infiniteOptions.searchUsers.key(config),
      )
    })

    it('derives the segment from request(initialPageParam), never from later page params', () => {
      const config = {
        initialPageParam: 'first',
        request: (pageParam: string) => ({ query: { cursor: pageParam } }),
        getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
      }

      expect(infiniteOptions.searchUsers(config).queryKey).toEqual([
        'nuxt-endpoints',
        'v1',
        'searchUsers',
        'infinite',
        { query: { cursor: 'first' } },
      ])
    })

    it('produces different keys when request closures embed different filter values', () => {
      const configA = {
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { cursor: pageParam, term: 'a' } }),
        getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
      }
      const configB = {
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { cursor: pageParam, term: 'b' } }),
        getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
      }

      expect(infiniteOptions.searchUsers(configA).queryKey).not.toEqual(
        infiniteOptions.searchUsers(configB).queryKey,
      )
    })

    it('includes the initial request idempotencyKey in infinite cache identity', () => {
      const config = (idempotencyKey: string) => ({
        initialPageParam: 'c0',
        request: () => ({ idempotencyKey }),
        getNextPageParam: (_page: SearchItemsPage) => undefined,
      })

      expect(infiniteOptions.retrySearch(config('request-1')).queryKey).toEqual([
        'nuxt-endpoints',
        'v1',
        'retrySearch',
        'infinite',
        { idempotencyKey: 'request-1' },
      ])
      expect(infiniteOptions.retrySearch(config('request-1')).queryKey).not.toEqual(
        infiniteOptions.retrySearch(config('request-2')).queryKey,
      )
    })

    it('appends and distinguishes keyScope', () => {
      const base = {
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { cursor: pageParam } }),
        getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
      }
      const noScope = infiniteOptions.searchUsers(base).queryKey
      const scopeA = infiniteOptions.searchUsers({ ...base, keyScope: 'scope-a' }).queryKey
      const scopeB = infiniteOptions.searchUsers({ ...base, keyScope: 'scope-b' }).queryKey

      expect(scopeA).not.toEqual(noScope)
      expect(scopeA).not.toEqual(scopeB)
      expect(scopeA).toEqual([...(noScope as unknown as unknown[]), 'scope-a'])
    })

    it('is deterministic under property insertion order', () => {
      const configA = {
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { term: 'x', cursor: pageParam } }),
        getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
      }
      const configB = {
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { cursor: pageParam, term: 'x' } }),
        getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
      }

      expect(infiniteOptions.searchUsers(configA).queryKey).toEqual(
        infiniteOptions.searchUsers(configB).queryKey,
      )
    })

    it('does not assume a page-param field name: an arbitrary field maps into the key', () => {
      const config = {
        initialPageParam: 'p0',
        request: (pageParam: string) => ({ query: { weirdCursorName: pageParam } }),
        getNextPageParam: (_page: SearchItemsPage) => undefined,
      }

      expect(infiniteOptions.searchItems(config).queryKey).toEqual([
        'nuxt-endpoints',
        'v1',
        'searchItems',
        'infinite',
        { query: { weirdCursorName: 'p0' } },
      ])
    })
  })

  describe('queryFn', () => {
    it('forwards the page request idempotencyKey', async () => {
      fetchMock.mockResolvedValue({ items: [] })
      const options = infiniteOptions.retrySearch({
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ idempotencyKey: `request-${pageParam}` }),
        getNextPageParam: (_page: SearchItemsPage) => undefined,
      })

      await options.queryFn({ pageParam: 'c1', signal: new AbortController().signal })

      expect(fetchMock).toHaveBeenCalledWith('/api/retry-search', {
        headers: { 'Idempotency-Key': 'request-c1' },
        method: 'get',
        signal: expect.any(AbortSignal),
      })
    })

    it('maps pageParam through request and forwards method + signal', async () => {
      fetchMock.mockResolvedValue({ items: [], nextCursor: 'c2' })
      const config = {
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { cursor: pageParam, term: 'x' } }),
        getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
      }
      const options = infiniteOptions.searchUsers(config)
      const signal = new AbortController().signal

      await options.queryFn({ pageParam: 'c1', signal })

      expect(fetchMock).toHaveBeenCalledWith('/api/users/search', {
        query: { cursor: 'c1', term: 'x' },
        method: 'get',
        signal,
      })
    })

    it('reflects an arbitrary page-param field name in the fetch call', async () => {
      fetchMock.mockResolvedValue({ items: [] })
      const config = {
        initialPageParam: 'p0',
        request: (pageParam: string) => ({ query: { weirdCursorName: pageParam } }),
        getNextPageParam: (_page: SearchItemsPage) => undefined,
      }
      const options = infiniteOptions.searchItems(config)

      await options.queryFn({ pageParam: 'p1', signal: new AbortController().signal })

      expect(fetchMock).toHaveBeenCalledWith('/api/items/search', {
        query: { weirdCursorName: 'p1' },
        method: 'get',
        signal: expect.any(AbortSignal),
      })
    })

    it('builds a fresh request per invocation', async () => {
      fetchMock.mockResolvedValue({ items: [], nextCursor: undefined })
      const options = infiniteOptions.searchUsers({
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { cursor: pageParam } }),
        getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
      })

      await options.queryFn({ pageParam: 'c0', signal: new AbortController().signal })
      await options.queryFn({ pageParam: 'c1', signal: new AbortController().signal })

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('propagates rejections in data mode', async () => {
      fetchMock.mockRejectedValueOnce(new Error('boom'))
      const options = infiniteOptions.searchUsers({
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { cursor: pageParam } }),
        getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
      })

      await expect(
        options.queryFn({ pageParam: 'c0', signal: new AbortController().signal }),
      ).rejects.toThrow('boom')
    })

    it('uses $fetch.raw with ignoreResponseError in result mode and omits headers', async () => {
      fetchRawMock.mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers(),
        _data: { items: ['a'], nextCursor: 'c1' },
      })
      const options = infiniteOptions.searchUsers.result({
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { cursor: pageParam } }),
        getNextPageParam: (page: { status: 200; ok: true; body: SearchUsersPage }) =>
          page.body.nextCursor,
      })

      const value = await options.queryFn({ pageParam: 'c0', signal: new AbortController().signal })

      expect(fetchRawMock).toHaveBeenCalledWith('/api/users/search', {
        query: { cursor: 'c0' },
        method: 'get',
        ignoreResponseError: true,
        signal: expect.any(AbortSignal),
      })
      expect(value).toEqual({ status: 200, ok: true, body: { items: ['a'], nextCursor: 'c1' } })
      expect('headers' in (value as object)).toBe(false)
    })
  })

  describe('config passthrough', () => {
    it('passes initialPageParam through unchanged', () => {
      const options = infiniteOptions.searchUsers({
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { cursor: pageParam } }),
        getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
      })

      expect(options.initialPageParam).toBe('c0')
    })

    it('passes getNextPageParam through by reference', () => {
      const getNextPageParam = (page: SearchUsersPage) => page.nextCursor
      const options = infiniteOptions.searchUsers({
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { cursor: pageParam } }),
        getNextPageParam,
      })

      expect(options.getNextPageParam).toBe(getNextPageParam)
    })

    it('omits getPreviousPageParam from the returned object when not provided', () => {
      const options = infiniteOptions.searchUsers({
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { cursor: pageParam } }),
        getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
      })

      expect('getPreviousPageParam' in options).toBe(false)
    })

    it('includes getPreviousPageParam by reference when provided', () => {
      const getPreviousPageParam = (page: SearchUsersPage) => page.nextCursor
      const options = infiniteOptions.searchUsers({
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { cursor: pageParam } }),
        getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
        getPreviousPageParam,
      })

      expect('getPreviousPageParam' in options).toBe(true)
      expect(options.getPreviousPageParam).toBe(getPreviousPageParam)
    })
  })

  describe('fetcher injection', () => {
    it('uses an injected fetcher instead of the global $fetch', async () => {
      const injectedData = vi.fn().mockResolvedValue({ items: [] })
      const injectedClient = createEndpointInfiniteQueryOptions(routesConfig, {
        fetcher: createFetcher(injectedData),
      }) as unknown as EndpointInfiniteQueryOptionsClient<Routes>

      const options = injectedClient.searchUsers({
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { cursor: pageParam } }),
        getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
      })
      await options.queryFn({ pageParam: 'c0', signal: new AbortController().signal })

      expect(injectedData).toHaveBeenCalledWith('/api/users/search', {
        query: { cursor: 'c0' },
        method: 'get',
        signal: expect.any(AbortSignal),
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('uses the value returned by captureFetcher', async () => {
      const capturedData = vi.fn().mockResolvedValue({ items: [] })
      const capturedClient = createEndpointInfiniteQueryOptions(routesConfig, {
        captureFetcher: () => createFetcher(capturedData),
      }) as unknown as EndpointInfiniteQueryOptionsClient<Routes>

      const options = capturedClient.searchUsers({
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { cursor: pageParam } }),
        getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
      })
      await options.queryFn({ pageParam: 'c0', signal: new AbortController().signal })

      expect(capturedData).toHaveBeenCalledWith('/api/users/search', {
        query: { cursor: 'c0' },
        method: 'get',
        signal: expect.any(AbortSignal),
      })
    })

    it('prefers an explicit fetcher over captureFetcher', async () => {
      const explicitData = vi.fn().mockResolvedValue({ items: [] })
      const captureData = vi.fn().mockResolvedValue({ items: [] })
      const winningClient = createEndpointInfiniteQueryOptions(routesConfig, {
        fetcher: createFetcher(explicitData),
        captureFetcher: () => createFetcher(captureData),
      }) as unknown as EndpointInfiniteQueryOptionsClient<Routes>

      const options = winningClient.searchUsers({
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { cursor: pageParam } }),
        getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
      })
      await options.queryFn({ pageParam: 'c0', signal: new AbortController().signal })

      expect(explicitData).toHaveBeenCalled()
      expect(captureData).not.toHaveBeenCalled()
    })

    it('captures the fetcher at factory-invocation time, not at queryFn execution time', async () => {
      const fetcherAData = vi.fn().mockResolvedValue({ items: [], from: 'A' })
      const fetcherBData = vi.fn().mockResolvedValue({ items: [], from: 'B' })
      const fetcherA = createFetcher(fetcherAData)
      const fetcherB = createFetcher(fetcherBData)
      let current = fetcherA
      const timingClient = createEndpointInfiniteQueryOptions(routesConfig, {
        captureFetcher: () => current,
      }) as unknown as EndpointInfiniteQueryOptionsClient<Routes>

      const options = timingClient.searchUsers({
        initialPageParam: 'c0',
        request: (pageParam: string) => ({ query: { cursor: pageParam } }),
        getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
      })
      current = fetcherB

      await options.queryFn({ pageParam: 'c0', signal: new AbortController().signal })

      expect(fetcherAData).toHaveBeenCalledTimes(1)
      expect(fetcherBData).not.toHaveBeenCalled()
    })
  })

  describe('real @tanstack/vue-query pagination', () => {
    let qc: QueryClient

    beforeEach(() => {
      qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    })

    afterEach(() => {
      qc.clear()
    })

    it('walks two pages via fetchInfiniteQuery({ pages: 2 }), matching getNextPageParam', async () => {
      fetchMock.mockImplementation(async (_path: string, opts: { query?: { cursor?: string } }) => {
        const cursor = opts.query?.cursor

        if (cursor === undefined) {
          return { items: ['a', 'b'], nextCursor: 'c1' }
        }
        if (cursor === 'c1') {
          return { items: ['c', 'd'], nextCursor: undefined }
        }

        throw new Error(`unexpected cursor ${cursor}`)
      })

      const config = {
        initialPageParam: undefined as string | undefined,
        request: (pageParam: string | undefined) => ({
          query: pageParam === undefined ? {} : { cursor: pageParam },
        }),
        getNextPageParam: (page: SearchUsersPage) => page.nextCursor,
      }
      const options = infiniteOptions.searchUsers(config)

      const data = await qc.fetchInfiniteQuery({ ...options, pages: 2 })

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/users/search', {
        query: {},
        method: 'get',
        signal: expect.any(AbortSignal),
      })
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/users/search', {
        query: { cursor: 'c1' },
        method: 'get',
        signal: expect.any(AbortSignal),
      })
      expect(data.pages).toEqual([
        { items: ['a', 'b'], nextCursor: 'c1' },
        { items: ['c', 'd'], nextCursor: undefined },
      ])
      expect(data.pageParams).toEqual([undefined, 'c1'])
      expect(qc.getQueryData(infiniteOptions.searchUsers.key(config))).toEqual(data)
    })
  })

  describe('prefetch recipe mechanics (regular non-infinite query factories)', () => {
    const regularOptions = createEndpointQueryOptions(
      routesConfig,
    ) as unknown as EndpointQueryOptionsClient<Routes>
    let qc: QueryClient

    beforeEach(() => {
      qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } })
    })

    afterEach(() => {
      qc.clear()
    })

    it('prefetchQuery populates the cache under the exact expected key', async () => {
      fetchMock.mockResolvedValue({ ok: true })
      const options = regularOptions.health()

      await qc.prefetchQuery(toPlainOptions(options))

      expect(qc.getQueryData(options.queryKey as EndpointQueryKey)).toEqual({ ok: true })
    })

    it('a subsequent ensureQueryData with non-zero staleTime does not refetch', async () => {
      fetchMock.mockResolvedValue({ ok: true })
      const options = regularOptions.health()

      await qc.prefetchQuery(toPlainOptions(options))
      const data = await qc.ensureQueryData(toPlainOptions(options))

      expect(data).toEqual({ ok: true })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })
})
