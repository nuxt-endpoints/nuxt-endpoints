import { QueryClient } from '@tanstack/vue-query'
import { isRef, ref } from 'vue'
import type { ComputedRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  EndpointFetcherRuntime,
  EndpointMutationOptionsClient,
  EndpointQueryKey,
  EndpointQueryOptionsClient,
  EndpointQueryOptionsObject,
} from '../src/runtime/tanstack-query'
import {
  createEndpointMutationOptions,
  createEndpointQueryOptions,
} from '../src/runtime/tanstack-query'
import type { StandardSchemaLike } from '../src/runtime'

const fetchMock = vi.fn()
const fetchRawMock = vi.fn()

type Schema<INPUT, OUTPUT = INPUT> = StandardSchemaLike<INPUT, OUTPUT>

type Routes =
  | {
      path: '/api/users/:id'
      method: 'get'
      operation: 'getUser'
      definition: {
        operation: 'getUser'
        params: Schema<{ id: string }>
      }
    }
  | {
      path: '/api/users'
      method: 'get'
      operation: 'listUsers'
      definition: {
        operation: 'listUsers'
        query: Schema<{ a: number; b: number }>
        headers: Schema<{ token: string }>
        body: Schema<{ note: string }>
      }
    }
  | {
      path: '/api/health'
      method: 'get'
      operation: 'health'
      definition: {
        operation: 'health'
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
      path: '/api/users/:id'
      method: 'put'
      operation: 'updateUser'
      definition: {
        operation: 'updateUser'
        params: Schema<{ id: string }>
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
      path: '/api/ctor'
      method: 'post'
      operation: 'constructor'
      definition: {
        operation: 'constructor'
      }
    }
  | {
      path: '/api/ping'
      method: 'post'
      operation: 'ping'
      definition: {
        operation: 'ping'
      }
    }
  | {
      path: '/api/retry-status'
      method: 'get'
      operation: 'retryStatus'
      definition: {
        operation: 'retryStatus'
        idempotency: {
          enabled: true
          headerName: 'Idempotency-Key'
          required: true
        }
      }
    }

const routesConfig = [
  { path: '/api/users/:id', method: 'get', operation: 'getUser' },
  { path: '/api/users', method: 'get', operation: 'listUsers' },
  { path: '/api/health', method: 'get', operation: 'health' },
  { path: '/api/users', method: 'post', operation: 'createUser' },
  { path: '/api/users/:id', method: 'put', operation: 'updateUser' },
  { path: '/api/reports', method: 'get' },
  { path: '/api/then', method: 'get', operation: 'then' },
  { path: '/api/ctor', method: 'post', operation: 'constructor' },
  { path: '/api/ping', method: 'post', operation: 'ping' },
  {
    path: '/api/retry-status',
    method: 'get',
    operation: 'retryStatus',
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

// Strict-context helper for direct queryFn invocations in unit tests: real
// TanStack Query always calls queryFn with { signal, queryKey } (both
// required as of the key-derived queryFn contract), so tests exercising
// queryFn directly (bypassing the QueryClient) must supply both explicitly.
function callQueryFn<DATA>(
  options: EndpointQueryOptionsObject<DATA>,
  overrides: { signal?: AbortSignal; queryKey?: EndpointQueryKey } = {},
) {
  return options.queryFn({
    signal: overrides.signal ?? new AbortController().signal,
    queryKey: overrides.queryKey ?? (options.queryKey as EndpointQueryKey),
  })
}

describe('TanStack Query adapter', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchRawMock.mockReset()
    vi.stubGlobal('$fetch', Object.assign(fetchMock, { raw: fetchRawMock }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const queryOptions = createEndpointQueryOptions(
    routesConfig,
  ) as unknown as EndpointQueryOptionsClient<Routes>
  const mutationOptions = createEndpointMutationOptions(
    routesConfig,
  ) as unknown as EndpointMutationOptionsClient<Routes>

  describe('classification', () => {
    it('exposes GET/HEAD operations on the query client only', () => {
      expect(Object.hasOwn(queryOptions, 'getUser')).toBe(true)
      expect(Object.hasOwn(queryOptions, 'createUser')).toBe(false)
    })

    it('exposes mutation operations on the mutation client only', () => {
      expect(Object.hasOwn(mutationOptions, 'createUser')).toBe(true)
      expect(Object.hasOwn(mutationOptions, 'getUser')).toBe(false)
    })

    it('skips routes without an operation', () => {
      expect(Object.hasOwn(queryOptions, 'undefined')).toBe(false)
      expect(Object.keys(queryOptions).sort()).toEqual(
        ['getUser', 'health', 'listUsers', 'retryStatus'].sort(),
      )
    })

    it('skips reserved operation names', () => {
      expect(Object.hasOwn(queryOptions, 'then')).toBe(false)
      expect(Object.hasOwn(mutationOptions, 'constructor')).toBe(false)
    })
  })

  describe('keys', () => {
    it('is deterministic under property insertion order', () => {
      const keyA = queryOptions.listUsers({
        query: { b: 1, a: 2 },
        headers: { token: 't1' },
        body: { note: 'hi' },
      }).queryKey
      const keyB = queryOptions.listUsers({
        query: { a: 2, b: 1 },
        headers: { token: 't1' },
        body: { note: 'hi' },
      }).queryKey

      expect(keyA).toEqual(keyB)
    })

    it('produces different keys for different inputs', () => {
      const key1 = queryOptions.getUser({ params: { id: '1' } }).queryKey
      const key2 = queryOptions.getUser({ params: { id: '2' } }).queryKey

      expect(key1).not.toEqual(key2)
    })

    it('includes idempotencyKey in cache identity', () => {
      const key1 = queryOptions.retryStatus({ idempotencyKey: 'request-1' }).queryKey
      const key2 = queryOptions.retryStatus({ idempotencyKey: 'request-2' }).queryKey

      expect(key1).not.toEqual(key2)
      expect(key1).toEqual(['nuxt-endpoints', 'v1', 'retryStatus', { idempotencyKey: 'request-1' }])
    })

    // `mediaType` selects a member of a media-type-map `body` contract, and a
    // FormData/URLSearchParams body always collapses to the same `{}` segment
    // under JSON-based key serialization (it has no enumerable own
    // properties), so without `mediaType` in the picked segment, two
    // different-media-type requests to the same route/params/query would
    // share a cache key. `listUsers`'s typed contract has a plain schema
    // body, so this reaches the dynamic factory directly to exercise the key
    // builder with a `mediaType` option untyped call sites don't have.
    it('includes mediaType in cache identity so different members do not collide', () => {
      const listUsersDynamic = queryOptions.listUsers as unknown as (
        options: Record<string, unknown>,
      ) => EndpointQueryOptionsObject<unknown>

      const jsonKey = listUsersDynamic({
        query: { a: 1, b: 2 },
        body: { note: 'hi' },
        mediaType: 'application/json',
      }).queryKey
      const multipartKey = listUsersDynamic({
        query: { a: 1, b: 2 },
        body: { note: 'hi' },
        mediaType: 'multipart/form-data',
      }).queryKey

      expect(jsonKey).not.toEqual(multipartKey)
    })

    // `accept` picks which representation the server sends back, so it is part
    // of what is cached, not part of how it was asked for. Reached through the
    // dynamic factory for the same reason as `mediaType` above: `listUsers`'s
    // typed contract declares no media response, so no typed call site can
    // pass it.
    it('includes accept in cache identity so representations do not collide', () => {
      const listUsersDynamic = queryOptions.listUsers as unknown as (
        options: Record<string, unknown>,
      ) => EndpointQueryOptionsObject<unknown>

      const csvKey = listUsersDynamic({ query: { a: 1, b: 2 }, accept: 'text/csv' }).queryKey
      const jsonKey = listUsersDynamic({
        query: { a: 1, b: 2 },
        accept: 'application/json',
      }).queryKey
      const sameCsvKey = listUsersDynamic({ query: { a: 1, b: 2 }, accept: 'text/csv' }).queryKey

      expect(csvKey).not.toEqual(jsonKey)
      expect(csvKey).toEqual(sameCsvKey)
    })

    it('excludes headers from the key', () => {
      const key1 = queryOptions.listUsers({
        query: { a: 1, b: 2 },
        headers: { token: 't1' },
        body: { note: 'hi' },
      }).queryKey
      const key2 = queryOptions.listUsers({
        query: { a: 1, b: 2 },
        headers: { token: 't2' },
        body: { note: 'hi' },
      }).queryKey

      expect(key1).toEqual(key2)
    })

    it('appends and distinguishes keyScope', () => {
      const noScope = queryOptions.getUser({ params: { id: '1' } }).queryKey
      const scopeA = queryOptions.getUser({ params: { id: '1' }, keyScope: 'scope-a' }).queryKey
      const scopeB = queryOptions.getUser({ params: { id: '1' }, keyScope: 'scope-b' }).queryKey

      expect(scopeA).not.toEqual(noScope)
      expect(scopeA).not.toEqual(scopeB)
      expect(scopeA).toEqual([...(noScope as unknown as unknown[]), 'scope-a'])
    })

    it('produces an empty segment for void input', () => {
      expect(queryOptions.health().queryKey).toEqual(['nuxt-endpoints', 'v1', 'health', {}])
    })

    it('matches the exact prefix/full/result key shapes', () => {
      expect(queryOptions.getUser.key()).toEqual(['nuxt-endpoints', 'v1', 'getUser'])
      expect(queryOptions.getUser.key({ params: { id: '1' } })).toEqual([
        'nuxt-endpoints',
        'v1',
        'getUser',
        { params: { id: '1' } },
      ])
      expect(queryOptions.getUser.result.key()).toEqual([
        'nuxt-endpoints',
        'v1',
        'getUser',
        'result',
      ])
      expect(queryOptions.getUser.result.key({ params: { id: '1' } })).toEqual([
        'nuxt-endpoints',
        'v1',
        'getUser',
        'result',
        { params: { id: '1' } },
      ])
    })

    it('differs between data and result full keys for identical input', () => {
      const dataKey = queryOptions.getUser({ params: { id: '1' } }).queryKey
      const resultKey = queryOptions.getUser.result({ params: { id: '1' } }).queryKey

      expect(dataKey).not.toEqual(resultKey)
    })
  })

  describe('queryFn', () => {
    it('substitutes path params and forwards query/headers/body, and the signal', async () => {
      fetchMock.mockResolvedValue({ items: [] })
      const options = queryOptions.listUsers({
        query: { a: 1, b: 2 },
        headers: { token: 't1' },
        body: { note: 'hi' },
      })
      const signal = new AbortController().signal

      await options.queryFn({ signal, queryKey: options.queryKey as EndpointQueryKey })

      expect(fetchMock).toHaveBeenCalledWith('/api/users', {
        query: { a: 1, b: 2 },
        headers: { token: 't1' },
        body: { note: 'hi' },
        method: 'get',
        signal,
      })
    })

    it('substitutes path params for the fetched URL', async () => {
      fetchMock.mockResolvedValue({ id: 123, name: 'Tom' })

      const data = await callQueryFn(queryOptions.getUser({ params: { id: '123' } }))

      expect(fetchMock).toHaveBeenCalledWith('/api/users/123', {
        method: 'get',
        signal: expect.any(AbortSignal),
      })
      expect(data).toEqual({ id: 123, name: 'Tom' })
    })

    it('strips keyScope from the fetch options', async () => {
      fetchMock.mockResolvedValue({ id: 1, name: 'Tom' })

      await callQueryFn(queryOptions.getUser({ params: { id: '1' }, keyScope: 'scope-a' }))

      expect(fetchMock).toHaveBeenCalledWith('/api/users/1', {
        method: 'get',
        signal: expect.any(AbortSignal),
      })
    })

    it('builds a fresh request per invocation', async () => {
      fetchMock.mockResolvedValue({ id: 1, name: 'Tom' })
      const options = queryOptions.getUser({ params: { id: '1' } })

      await callQueryFn(options)
      await callQueryFn(options)

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('propagates rejections in data mode', async () => {
      fetchMock.mockRejectedValueOnce(new Error('boom'))

      await expect(callQueryFn(queryOptions.getUser({ params: { id: '1' } }))).rejects.toThrow(
        'boom',
      )
    })

    it('uses $fetch.raw with ignoreResponseError in result mode and omits headers', async () => {
      fetchRawMock.mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers(),
        _data: { id: 1, name: 'Tom' },
      })

      const value = await callQueryFn(queryOptions.getUser.result({ params: { id: '1' } }))

      expect(fetchRawMock).toHaveBeenCalledWith('/api/users/1', {
        method: 'get',
        ignoreResponseError: true,
        signal: expect.any(AbortSignal),
      })
      expect(value).toEqual({ status: 200, ok: true, body: { id: 1, name: 'Tom' } })
      expect('headers' in (value as object)).toBe(false)
    })
  })

  describe('reactivity', () => {
    it('pins getter idempotencyKey to the queryKey used for execution', async () => {
      const idempotencyKey = ref('request-1')
      const options = queryOptions.retryStatus(() => ({
        idempotencyKey: idempotencyKey.value,
      }))
      const queryKey = options.queryKey as ComputedRef<EndpointQueryKey>
      const oldKey = queryKey.value

      idempotencyKey.value = 'request-2'
      expect(queryKey.value).not.toEqual(oldKey)

      fetchMock.mockResolvedValue({ ok: true })
      await callQueryFn(options, { queryKey: oldKey })

      expect(fetchMock).toHaveBeenCalledWith('/api/retry-status', {
        headers: { 'Idempotency-Key': 'request-1' },
        method: 'get',
        signal: expect.any(AbortSignal),
      })
    })

    it('tracks a getter through a computed queryKey and refetches the new path', async () => {
      const id = ref('1')
      const options = queryOptions.getUser(() => ({ params: { id: id.value } }))
      const queryKey = options.queryKey as ComputedRef<EndpointQueryKey>

      expect(isRef(options.queryKey)).toBe(true)
      expect(queryKey.value).toEqual(['nuxt-endpoints', 'v1', 'getUser', { params: { id: '1' } }])

      id.value = '2'

      expect(queryKey.value).toEqual(['nuxt-endpoints', 'v1', 'getUser', { params: { id: '2' } }])

      fetchMock.mockResolvedValue({ id: 2, name: 'Tom' })
      await callQueryFn(options, { queryKey: queryKey.value })

      expect(fetchMock).toHaveBeenCalledWith('/api/users/2', {
        method: 'get',
        signal: expect.any(AbortSignal),
      })
    })

    it('derives the request from the passed queryKey even if the getter has since moved on', async () => {
      // Race-elimination guarantee: queryFn must pair with whatever queryKey
      // TanStack Query actually passed in, not with whatever the getter
      // currently resolves to. This matters because the ref backing the
      // getter can change between the moment TanStack captures the key and
      // the moment it later invokes queryFn (e.g. a stale in-flight refetch).
      const id = ref('1')
      const options = queryOptions.getUser(() => ({ params: { id: id.value } }))
      const queryKey = options.queryKey as ComputedRef<EndpointQueryKey>
      const oldKey = queryKey.value

      id.value = '2'
      expect(queryKey.value).not.toEqual(oldKey)

      fetchMock.mockResolvedValue({ id: 1, name: 'Old' })
      await callQueryFn(options, { queryKey: oldKey })

      // The getter now resolves to id '2', but the OLD key was passed to
      // queryFn, so the fetch must still hit the OLD path.
      expect(fetchMock).toHaveBeenCalledWith('/api/users/1', {
        method: 'get',
        signal: expect.any(AbortSignal),
      })
    })

    it('reads headers live from the getter while params/query/body stay pinned to the passed queryKey', async () => {
      // Headers are deliberately excluded from cache identity (see the
      // "excludes headers from the key" test above), so "current headers" is
      // the correct semantic even when params/query/body are pinned to a
      // stale key.
      const a = ref(1)
      const token = ref('t1')
      const options = queryOptions.listUsers(() => ({
        query: { a: a.value, b: 2 },
        headers: { token: token.value },
        body: { note: 'hi' },
      }))
      const queryKey = options.queryKey as ComputedRef<EndpointQueryKey>
      const oldKey = queryKey.value

      a.value = 99
      token.value = 't2'

      fetchMock.mockResolvedValue({ items: [] })
      await callQueryFn(options, { queryKey: oldKey })

      expect(fetchMock).toHaveBeenCalledWith('/api/users', {
        query: { a: 1, b: 2 },
        headers: { token: 't2' },
        body: { note: 'hi' },
        method: 'get',
        signal: expect.any(AbortSignal),
      })
    })
  })

  describe('fetcher injection', () => {
    it('uses an injected fetcher instead of the global $fetch', async () => {
      const injectedData = vi.fn().mockResolvedValue({ id: 9, name: 'Injected' })
      const injectedClient = createEndpointQueryOptions(routesConfig, {
        fetcher: createFetcher(injectedData),
      }) as unknown as EndpointQueryOptionsClient<Routes>

      await callQueryFn(injectedClient.getUser({ params: { id: '9' } }))

      expect(injectedData).toHaveBeenCalledWith('/api/users/9', {
        method: 'get',
        signal: expect.any(AbortSignal),
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('uses the value returned by captureFetcher', async () => {
      const capturedData = vi.fn().mockResolvedValue({ id: 5, name: 'Captured' })
      const capturedClient = createEndpointQueryOptions(routesConfig, {
        captureFetcher: () => createFetcher(capturedData),
      }) as unknown as EndpointQueryOptionsClient<Routes>

      await callQueryFn(capturedClient.getUser({ params: { id: '5' } }))

      expect(capturedData).toHaveBeenCalledWith('/api/users/5', {
        method: 'get',
        signal: expect.any(AbortSignal),
      })
    })

    it('prefers an explicit fetcher over captureFetcher', async () => {
      const explicitData = vi.fn().mockResolvedValue({ id: 1 })
      const captureData = vi.fn().mockResolvedValue({ id: 2 })
      const winningClient = createEndpointQueryOptions(routesConfig, {
        fetcher: createFetcher(explicitData),
        captureFetcher: () => createFetcher(captureData),
      }) as unknown as EndpointQueryOptionsClient<Routes>

      await callQueryFn(winningClient.getUser({ params: { id: '1' } }))

      expect(explicitData).toHaveBeenCalled()
      expect(captureData).not.toHaveBeenCalled()
    })

    it('captures the fetcher at factory-invocation time, not at queryFn execution time', async () => {
      const fetcherAData = vi.fn().mockResolvedValue({ from: 'A' })
      const fetcherBData = vi.fn().mockResolvedValue({ from: 'B' })
      const fetcherA = createFetcher(fetcherAData)
      const fetcherB = createFetcher(fetcherBData)
      let current = fetcherA
      const timingClient = createEndpointQueryOptions(routesConfig, {
        captureFetcher: () => current,
      }) as unknown as EndpointQueryOptionsClient<Routes>

      const options = timingClient.getUser({ params: { id: '1' } })
      current = fetcherB

      await callQueryFn(options)

      expect(fetcherAData).toHaveBeenCalledTimes(1)
      expect(fetcherBData).not.toHaveBeenCalled()
    })
  })

  describe('mutations', () => {
    it('matches mutationKey shapes', () => {
      expect(mutationOptions.createUser.key()).toEqual(['nuxt-endpoints', 'v1', 'createUser'])
      expect(mutationOptions.createUser().mutationKey).toEqual([
        'nuxt-endpoints',
        'v1',
        'createUser',
      ])
      expect(mutationOptions.createUser.result().mutationKey).toEqual([
        'nuxt-endpoints',
        'v1',
        'createUser',
        'result',
      ])
    })

    it('forwards variables as request options and substitutes params on a fresh request per call', async () => {
      fetchMock
        .mockResolvedValueOnce({ id: 1, name: 'A' })
        .mockResolvedValueOnce({ id: 2, name: 'B' })
      const mutation = mutationOptions.updateUser()

      await mutation.mutationFn({ params: { id: '1' }, body: { name: 'A' } })
      await mutation.mutationFn({ params: { id: '2' }, body: { name: 'B' } })

      expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/users/1', {
        body: { name: 'A' },
        method: 'put',
      })
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/users/2', {
        body: { name: 'B' },
        method: 'put',
      })
    })

    it('resolves result mode without headers', async () => {
      fetchRawMock.mockResolvedValue({
        status: 201,
        ok: true,
        headers: new Headers(),
        _data: { id: 1, name: 'Tom' },
      })

      const value = await mutationOptions.createUser.result().mutationFn({ body: { name: 'Tom' } })

      expect(value).toEqual({ status: 201, ok: true, body: { id: 1, name: 'Tom' } })
      expect('headers' in (value as object)).toBe(false)
    })

    it('accepts undefined variables for void-input mutations', async () => {
      fetchMock.mockResolvedValue({ ok: true })

      await mutationOptions.ping().mutationFn(undefined)

      expect(fetchMock).toHaveBeenCalledWith('/api/ping', { method: 'post' })
    })
  })

  describe('real @tanstack/vue-query integration', () => {
    let qc: QueryClient

    beforeEach(() => {
      qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    })

    afterEach(() => {
      qc.clear()
    })

    it('resolves the mocked body and caches it under the exact expected key', async () => {
      fetchMock.mockResolvedValue({ id: 1, name: 'Tom' })
      const options = queryOptions.getUser({ params: { id: '1' } })

      const data = await qc.fetchQuery(toPlainOptions(options))

      expect(data).toEqual({ id: 1, name: 'Tom' })
      expect(qc.getQueryData(options.queryKey as EndpointQueryKey)).toEqual({
        id: 1,
        name: 'Tom',
      })
    })

    it('aborts the forwarded signal when the query is cancelled', async () => {
      let capturedSignal: AbortSignal | undefined
      fetchMock.mockImplementation((_path: string, opts: { signal?: AbortSignal }) => {
        capturedSignal = opts.signal
        return new Promise(() => {})
      })
      const options = queryOptions.getUser({ params: { id: '2' } })

      const promise = qc.fetchQuery(toPlainOptions(options))
      await new Promise((resolve) => setTimeout(resolve, 0))
      await qc.cancelQueries({ queryKey: queryOptions.getUser.key() })

      await expect(promise).rejects.toBeTruthy()
      expect(capturedSignal?.aborted).toBe(true)
    })

    it('performs a second fetch call on refetch', async () => {
      fetchMock.mockResolvedValue({ id: 3, name: 'A' })
      const options = queryOptions.getUser({ params: { id: '3' } })

      await qc.fetchQuery(toPlainOptions(options))
      await qc.refetchQueries({ queryKey: options.queryKey as EndpointQueryKey })

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('resolves declared error statuses through result mode instead of rejecting', async () => {
      fetchRawMock.mockResolvedValue({
        status: 404,
        ok: false,
        headers: new Headers(),
        _data: { message: 'Not found' },
      })
      const options = queryOptions.getUser.result({ params: { id: '404' } })

      const data = await qc.fetchQuery(toPlainOptions(options))

      expect(data).toEqual({ status: 404, ok: false, body: { message: 'Not found' } })
    })

    it('rejects fetchQuery in data mode when the underlying fetch rejects', async () => {
      fetchMock.mockRejectedValue(new Error('Not Found'))
      const options = queryOptions.getUser({ params: { id: '404' } })

      await expect(qc.fetchQuery(toPlainOptions(options))).rejects.toThrow('Not Found')
    })
  })
})
