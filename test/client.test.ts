import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEndpointClient, createUseEndpoint } from '../src/runtime'
import type { EndpointCallInfiniteQueryOptionsRuntime } from '../src/runtime/client'
import {
  EndpointPaginationError,
  infiniteQueryOptions,
  mutationOptions,
  queryOptions,
} from '../src/runtime/colada'

const fetchMock = vi.fn()
const fetchRawMock = vi.fn()

type UseAsyncDataStub = {
  key: string
  options?: Record<string, unknown>
  run: (signal?: AbortSignal) => Promise<unknown>
}

describe('createEndpointClient', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchRawMock.mockReset()
    fetchRawMock.mockImplementation(async (path: string, options: Record<string, unknown> = {}) => {
      const { ignoreResponseError: _ignoreResponseError, ...dataOptions } = options
      return {
        status: 200,
        ok: true,
        headers: new Headers(),
        _data: await fetchMock(path, dataOptions),
      }
    })
    vi.stubGlobal('$fetch', Object.assign(fetchMock, { raw: fetchRawMock }))
  })

  it('replaces path params and forwards fetch options', async () => {
    fetchMock.mockResolvedValue({ id: 123, name: 'Tom' })

    const client = createEndpointClient([{ path: '/api/users/:id', method: 'get' }])

    await client('/api/users/:id', {
      method: 'get',
      params: { id: 123 },
      query: { include: 'profile' },
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/users/123', {
      query: { include: 'profile' },
      method: 'get',
    })

    await client('/api/users/:id', {
      method: 'get',
      params: { id: 456 },
    })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/users/456', {
      method: 'get',
    })
  })

  it('returns typed status data when awaited', async () => {
    const headers = new Headers({ 'x-request-id': 'req-1' })
    fetchRawMock.mockResolvedValue({
      status: 404,
      ok: false,
      headers,
      _data: { message: 'Not found' },
    })

    const client = createEndpointClient([{ path: '/api/users/:id', method: 'get' }])

    const response = await client('/api/users/:id', {
      method: 'get',
      params: { id: 404 },
      query: { include: 'profile' },
    })

    expect(fetchRawMock).toHaveBeenCalledWith('/api/users/404', {
      query: { include: 'profile' },
      method: 'get',
      ignoreResponseError: true,
    })
    expect(response).toEqual({
      status: 404,
      ok: false,
      headers,
      body: { message: 'Not found' },
    })
  })

  it('returns Web Response values through raw calls', async () => {
    fetchRawMock.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      ok: true,
      headers: new Headers({ 'x-request-id': 'req-1' }),
      _data: { id: 123, name: 'Tom' },
    })

    const client = createEndpointClient([{ path: '/api/users/:id', method: 'get' }])

    const response = await client('/api/users/:id', {
      method: 'get',
      params: { id: 123 },
      query: { include: 'profile' },
    }).raw()

    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(200)
    expect(response.ok).toBe(true)
    expect(response.headers.get('x-request-id')).toBe('req-1')
    await expect(response.json()).resolves.toEqual({ id: 123, name: 'Tom' })
    expect(fetchRawMock).toHaveBeenCalledWith('/api/users/123', {
      query: { include: 'profile' },
      method: 'get',
      ignoreResponseError: true,
    })
  })

  it('throws when a path parameter is missing', () => {
    const client = createEndpointClient([{ path: '/api/users/:id', method: 'get' }])

    expect(() => client('/api/users/:id', { method: 'get', params: {} })).toThrow(
      /Missing path parameter "id"/,
    )
  })

  it('maps idempotencyKey to the generated route header without leaking the option', async () => {
    fetchMock.mockResolvedValue({ id: 1 })
    const client = createEndpointClient([
      {
        path: '/api/items',
        method: 'post',
        idempotency: { headerName: 'X-Request-Key', required: true },
      },
    ])

    await client('/api/items', {
      method: 'post',
      idempotencyKey: 'request-1',
      body: { amount: 100 },
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/items', {
      body: { amount: 100 },
      headers: { 'X-Request-Key': 'request-1' },
      method: 'post',
    })
  })

  it('generates one stable key when required idempotency is omitted', async () => {
    fetchMock.mockResolvedValue({ id: 1 })
    const client = createEndpointClient([
      {
        path: '/api/items',
        method: 'post',
        idempotency: { headerName: 'Idempotency-Key', required: true },
      },
    ])

    const request = client('/api/items', { method: 'post', body: { amount: 100 } })
    await request
    await request

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>
    expect(headers['Idempotency-Key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('generates a key on demand for optional idempotency', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    const client = createEndpointClient([
      {
        path: '/api/check',
        method: 'post',
        idempotency: { headerName: 'Idempotency-Key', required: false },
      },
    ])

    await client('/api/check', { method: 'post', idempotencyKey: true })

    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('connects one request object to Pinia Colada query options', async () => {
    fetchMock.mockResolvedValue({ id: 123, name: 'Tom' })
    const client = createEndpointClient([{ path: '/api/users/:id', method: 'get' }])
    const request = client('/api/users/:id', { method: 'get', params: { id: 123 } })
    const options = queryOptions(request)

    expect(options.key).toEqual([
      'nuxt-endpoints',
      'v2',
      'get',
      '/api/users/:id',
      '{"params":{"id":123}}',
    ])
    await expect(options.query({ signal: new AbortController().signal })).resolves.toEqual({
      status: 200,
      ok: true,
      body: { id: 123, name: 'Tom' },
    })
  })

  it('maps a cursor-pagination request to Pinia Colada infinite-query options', async () => {
    fetchMock
      .mockResolvedValueOnce({ items: [{ id: 1 }], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ items: [{ id: 2 }] })
    const client = createEndpointClient([
      {
        path: '/api/articles',
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
    const request = client('/api/articles', {
      method: 'get',
      query: { limit: 20, category: 'news' },
    })
    const options = infiniteQueryOptions(
      request as never,
    ) as EndpointCallInfiniteQueryOptionsRuntime

    expect(options.initialPageParam).toBeUndefined()
    expect(options.key.at(-1)).toBe('{"query":{"category":"news","limit":20}}')
    const first = await options.query({
      signal: new AbortController().signal,
      pageParam: undefined,
    })
    expect(options.getNextPageParam(first)).toBe('page-2')
    const second = await options.query({
      signal: new AbortController().signal,
      pageParam: 'page-2',
    })
    expect(options.getNextPageParam(second)).toBeUndefined()
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/articles',
      expect.objectContaining({
        query: { limit: 20, category: 'news' },
        method: 'get',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/articles',
      expect.objectContaining({
        query: { limit: 20, category: 'news', cursor: 'page-2' },
        method: 'get',
      }),
    )
  })

  it('retains a non-success page result in a pagination error', async () => {
    fetchRawMock.mockResolvedValue({
      status: 429,
      ok: false,
      headers: new Headers({ 'retry-after': '10' }),
      _data: { message: 'Slow down' },
    })
    const client = createEndpointClient([
      {
        path: '/api/articles',
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
    const options = infiniteQueryOptions(
      client('/api/articles', { method: 'get' }) as never,
    ) as EndpointCallInfiniteQueryOptionsRuntime

    await expect(
      options.query({ signal: new AbortController().signal, pageParam: undefined }),
    ).rejects.toMatchObject({
      name: 'EndpointPaginationError',
      result: {
        status: 429,
        ok: false,
        body: { message: 'Slow down' },
      },
    })

    try {
      await options.query({ signal: new AbortController().signal, pageParam: undefined })
    } catch (error) {
      expect(error).toBeInstanceOf(EndpointPaginationError)
    }
  })

  it('rejects the wrong method and non-endpoint values at runtime', () => {
    const client = createEndpointClient([
      { path: '/api/users', method: 'get' },
      { path: '/api/users', method: 'post' },
    ])
    const get = client('/api/users', { method: 'get' })
    const post = client('/api/users', { method: 'post' })

    expect(() => mutationOptions(get as never)).toThrow(
      /only accepts a POST, PUT, PATCH, or DELETE/,
    )
    expect(() => queryOptions(post as never)).toThrow(/only accepts a GET or HEAD/)
    expect(() => queryOptions(Promise.resolve({}) as never)).toThrow(
      /request object returned by \$endpoint/,
    )
    expect(() => infiniteQueryOptions(get as never)).toThrow(/declaring cursor pagination/)
  })

  it('derives the same query key regardless of request key order', async () => {
    fetchMock.mockResolvedValue({ items: [] })
    const client = createEndpointClient([{ path: '/api/users/search', method: 'get' }])
    const declaredOrder = client('/api/users/search', {
      method: 'get',
      query: { limit: 10, q: 'ada', filter: { role: 'admin', active: true } },
    })
    const reversedOrder = client('/api/users/search', {
      method: 'get',
      query: { filter: { active: true, role: 'admin' }, q: 'ada', limit: 10 },
    })

    // Nested objects are sorted too, so this holds at every depth rather than
    // only for the top-level request record.
    expect(queryOptions(reversedOrder).key).toEqual(queryOptions(declaredOrder).key)
    expect(queryOptions(declaredOrder).key.at(-1)).toBe(
      '{"query":{"filter":{"active":true,"role":"admin"},"limit":10,"q":"ada"}}',
    )
  })

  it('keeps array order significant in the query key', async () => {
    fetchMock.mockResolvedValue({ items: [] })
    const client = createEndpointClient([{ path: '/api/users/search', method: 'get' }])
    const ascending = client('/api/users/search', {
      method: 'get',
      query: { tags: ['a', 'b'] },
    })
    const descending = client('/api/users/search', {
      method: 'get',
      query: { tags: ['b', 'a'] },
    })

    // Sorting request keys must not extend to array members: a reordered array
    // is a different request, and collapsing the two would serve stale data.
    expect(queryOptions(descending).key).not.toEqual(queryOptions(ascending).key)
    expect(queryOptions(ascending).key.at(-1)).toBe('{"query":{"tags":["a","b"]}}')
  })

  it('reuses an automatically generated key across repeated Colada mutation execution', async () => {
    fetchMock.mockResolvedValue({ id: 1 })
    const client = createEndpointClient([
      {
        path: '/api/items',
        method: 'post',
        idempotency: { headerName: 'Idempotency-Key', required: true },
      },
    ])
    const request = client('/api/items', { method: 'post', body: { amount: 100 } })
    const options = mutationOptions(request)

    await options.mutation()
    await options.mutation()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstHeaders = fetchMock.mock.calls[0]![1].headers as Record<string, string>
    const secondHeaders = fetchMock.mock.calls[1]![1].headers as Record<string, string>
    expect(firstHeaders['Idempotency-Key']).toBe(secondHeaders['Idempotency-Key'])
    expect(JSON.parse(options.key.at(-1)!)).toEqual({
      body: { amount: 100 },
      idempotencyKey: firstHeaders['Idempotency-Key'],
    })
  })

  it('enforces generated idempotency metadata for untyped callers', async () => {
    const requiredClient = createEndpointClient([
      {
        path: '/api/items',
        method: 'post',
        idempotency: { headerName: 'Idempotency-Key', required: true },
      },
    ])

    expect(() => requiredClient('/api/items', { method: 'post', idempotencyKey: '' })).toThrow(
      /non-empty string/i,
    )
    expect(() =>
      requiredClient('/api/items', { method: 'post', idempotencyKey: 'one,two' }),
    ).toThrow(/without commas/i)
    expect(() =>
      requiredClient('/api/items', { method: 'post', idempotencyKey: 'line\nbreak' }),
    ).toThrow(/control characters/i)
    expect(() =>
      requiredClient('/api/items', {
        method: 'post',
        idempotencyKey: 'request-1',
        headers: { 'IDEMPOTENCY-KEY': 'request-1' },
      }),
    ).toThrow(/both idempotencyKey and Idempotency-Key/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('supports Headers and tuple inputs while detecting case-insensitive duplicates', async () => {
    fetchMock.mockResolvedValue({ id: 1 })
    const client = createEndpointClient([
      {
        path: '/api/items',
        method: 'post',
        idempotency: { headerName: 'Idempotency-Key', required: true },
      },
    ])

    await client('/api/items', {
      method: 'post',
      idempotencyKey: 'request-1',
      headers: new Headers({ 'x-trace': 'trace-1' }),
    })
    const sentHeaders = fetchMock.mock.calls[0]![1].headers as Headers
    expect(sentHeaders).toBeInstanceOf(Headers)
    expect(sentHeaders.get('idempotency-key')).toBe('request-1')
    expect(sentHeaders.get('x-trace')).toBe('trace-1')

    expect(() =>
      client('/api/items', {
        method: 'post',
        idempotencyKey: 'request-2',
        headers: [['IDEMPOTENCY-KEY', 'duplicate']],
      }),
    ).toThrow(/both idempotencyKey and Idempotency-Key/i)
  })

  it('keeps the whole options argument optional for optional idempotency', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    const client = createEndpointClient([
      {
        path: '/api/check',
        method: 'post',
        idempotency: { headerName: 'Idempotency-Key', required: false },
      },
    ])

    await client('/api/check', { method: 'post' })
    await client('/api/check', { method: 'post', idempotencyKey: 'request-1' })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/check', { method: 'post' })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/check', {
      headers: { 'Idempotency-Key': 'request-1' },
      method: 'post',
    })
  })

  describe('mediaType body options', () => {
    it('does not set a content-type header for a multipart/form-data mediaType', async () => {
      fetchMock.mockResolvedValue({ ok: true })
      const client = createEndpointClient([{ path: '/api/upload', method: 'post' }])
      const formData = new FormData()
      formData.append('name', 'Tom')

      await client('/api/upload', {
        method: 'post',
        mediaType: 'multipart/form-data',
        body: formData,
      })

      expect(fetchMock).toHaveBeenCalledWith('/api/upload', {
        body: formData,
        method: 'post',
      })
      const calledOptions = fetchMock.mock.calls[0]![1] as Record<string, unknown>
      expect(calledOptions.headers).toBeUndefined()
    })

    it('labels an application/x-www-form-urlencoded body itself', async () => {
      // No boundary is involved, so the client can set the header rather than
      // depending on the request being built by a real fetch - which a Nuxt
      // server-side call to a local route is not.
      fetchMock.mockResolvedValue({ ok: true })
      const client = createEndpointClient([{ path: '/api/notes', method: 'post' }])
      const params = new URLSearchParams({ note: 'hi' })

      await client('/api/notes', {
        method: 'post',
        mediaType: 'application/x-www-form-urlencoded',
        body: params,
      })

      expect(fetchMock).toHaveBeenCalledWith('/api/notes', {
        body: params,
        method: 'post',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
    })

    it('keeps a caller-supplied content-type for a urlencoded body', async () => {
      fetchMock.mockResolvedValue({ ok: true })
      const client = createEndpointClient([{ path: '/api/notes', method: 'post' }])

      await client('/api/notes', {
        method: 'post',
        mediaType: 'application/x-www-form-urlencoded',
        body: new URLSearchParams({ note: 'hi' }),
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      })

      expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      })
    })

    it('does not leak the mediaType option to the fetcher', async () => {
      fetchMock.mockResolvedValue({ ok: true })
      const client = createEndpointClient([{ path: '/api/notes', method: 'post' }])

      await client('/api/notes', {
        method: 'post',
        mediaType: 'application/json',
        body: { note: 'hi' },
      })

      const calledOptions = fetchMock.mock.calls[0]![1] as Record<string, unknown>
      expect(calledOptions).not.toHaveProperty('mediaType')
      expect(calledOptions).toEqual({
        body: { note: 'hi' },
        method: 'post',
        headers: { 'content-type': 'application/json' },
      })
    })

    it('throws when mediaType is not a string', () => {
      const client = createEndpointClient([{ path: '/api/notes', method: 'post' }])

      expect(() =>
        client('/api/notes', { method: 'post', mediaType: 123 as unknown as string, body: 'x' }),
      ).toThrow(/mediaType option must be a string/)
    })
  })

  describe('media response routes', () => {
    it('sets responseType: stream in the fetcher options for a media response route', async () => {
      fetchMock.mockResolvedValue(new ReadableStream())
      const client = createEndpointClient([
        { path: '/api/export', method: 'get', mediaResponse: true },
      ])

      await client('/api/export', { method: 'get' })

      expect(fetchMock).toHaveBeenCalledWith('/api/export', {
        method: 'get',
        responseType: 'stream',
      })
    })

    it('does not set responseType for a route without a media response', async () => {
      fetchMock.mockResolvedValue({ id: 123, name: 'Tom' })
      const client = createEndpointClient([{ path: '/api/users/:id', method: 'get' }])

      await client('/api/users/:id', { method: 'get', params: { id: 123 } })

      const calledOptions = fetchMock.mock.calls[0]![1] as Record<string, unknown>
      expect(calledOptions).not.toHaveProperty('responseType')
    })

    it('preserves an explicit caller responseType over the stream default', async () => {
      fetchMock.mockResolvedValue(new Blob())
      const client = createEndpointClient([
        { path: '/api/export', method: 'get', mediaResponse: true },
      ])

      await client('/api/export', { method: 'get', responseType: 'blob' })

      expect(fetchMock).toHaveBeenCalledWith('/api/export', {
        method: 'get',
        responseType: 'blob',
      })
    })

    it('sends the accept option as the accept header without leaking it to the fetcher', async () => {
      fetchMock.mockResolvedValue(new ReadableStream())
      const client = createEndpointClient([
        { path: '/api/export', method: 'get', mediaResponse: true },
      ])

      await client('/api/export', { method: 'get', accept: 'application/json' })

      const calledOptions = fetchMock.mock.calls[0]![1] as Record<string, unknown>
      expect(calledOptions).not.toHaveProperty('accept')
      expect(calledOptions).toEqual({
        method: 'get',
        responseType: 'stream',
        headers: { accept: 'application/json' },
      })
    })

    it('lets a caller-set Accept header win over the accept option', async () => {
      fetchMock.mockResolvedValue(new ReadableStream())
      const client = createEndpointClient([
        { path: '/api/export', method: 'get', mediaResponse: true },
      ])

      await client('/api/export', {
        method: 'get',
        accept: 'application/json',
        headers: { Accept: 'text/csv' },
      } as never)

      expect(fetchMock).toHaveBeenCalledWith('/api/export', {
        method: 'get',
        responseType: 'stream',
        headers: { Accept: 'text/csv' },
      })
    })

    it('rejects an accept option that is not a non-empty string', () => {
      fetchMock.mockResolvedValue(new ReadableStream())
      const client = createEndpointClient([
        { path: '/api/export', method: 'get', mediaResponse: true },
      ])

      // Rejected rather than ignored, like its sibling selectors: a dropped
      // `accept` comes back as the wrong representation, which is harder to
      // trace than a throw.
      expect(() => client('/api/export', { method: 'get', accept: 123 })).toThrow(
        /accept option must be a non-empty string/,
      )
      expect(() => client('/api/export', { method: 'get', accept: '  ' })).toThrow(
        /accept option must be a non-empty string/,
      )
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('keeps every caller header when they arrive as a Headers instance', async () => {
      fetchMock.mockResolvedValue(new ReadableStream())
      const client = createEndpointClient([
        {
          path: '/api/export',
          method: 'post',
          mediaResponse: true,
          idempotency: { headerName: 'Idempotency-Key', required: true },
        },
      ])

      await client('/api/export', {
        method: 'post',
        accept: 'application/json',
        idempotencyKey: 'request-1',
        headers: new Headers({ authorization: 'Bearer token' }),
      } as never)

      const calledOptions = fetchMock.mock.calls[0]![1] as { headers: Headers }
      // The idempotency key is set on a Headers instance first, so flattening
      // that instance here would silently turn an idempotent write into an
      // ordinary one.
      expect(calledOptions.headers.get('idempotency-key')).toBe('request-1')
      expect(calledOptions.headers.get('authorization')).toBe('Bearer token')
      expect(calledOptions.headers.get('accept')).toBe('application/json')
    })

    it('keeps every caller header when they arrive as a tuple list', async () => {
      fetchMock.mockResolvedValue(new ReadableStream())
      const client = createEndpointClient([
        { path: '/api/export', method: 'get', mediaResponse: true },
      ])

      await client('/api/export', {
        method: 'get',
        accept: 'application/json',
        headers: [['authorization', 'Bearer token']],
      } as never)

      const calledOptions = fetchMock.mock.calls[0]![1] as { headers: Headers }
      expect(calledOptions.headers.get('authorization')).toBe('Bearer token')
      expect(calledOptions.headers.get('accept')).toBe('application/json')
    })
  })

  it('wraps endpoint data calls with useAsyncData', async () => {
    fetchMock.mockResolvedValue({ id: 123, name: 'Tom' })

    const useAsyncDataMock = vi.fn(
      (
        key: string,
        handler: (_nuxtApp: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>,
        options?: Record<string, unknown>,
      ): UseAsyncDataStub => {
        return {
          key,
          options,
          run(signal = new AbortController().signal) {
            return handler({}, { signal })
          },
        }
      },
    )
    const useEndpoint = createUseEndpoint(
      [{ path: '/api/users/:id', method: 'get' }],
      useAsyncDataMock,
    )

    const state = useEndpoint('/api/users/:id', {
      method: 'get',
      params: { id: 123 },
      key: 'user:123',
      lazy: true,
    }) as UseAsyncDataStub

    expect(state.key).toBe('user:123')
    expect(state.options).toEqual({ lazy: true })

    const signal = new AbortController().signal
    await state.run(signal)

    expect(fetchMock).toHaveBeenCalledWith('/api/users/123', {
      method: 'get',
      signal,
    })

    const secondState = useEndpoint('/api/users/:id', {
      method: 'get',
      params: { id: 456 },
      lazy: true,
    }) as UseAsyncDataStub

    expect(secondState.key).toBe('$endpoint:get:/api/users/:id:{"params":{"id":456}}')
    expect(secondState.options).toEqual({ lazy: true })
    await secondState.run(signal)

    expect(fetchMock).toHaveBeenLastCalledWith('/api/users/456', {
      method: 'get',
      signal,
    })
  })

  it('generates stable useAsyncData keys for endpoint calls', () => {
    const useAsyncDataMock = vi.fn(
      (
        key: string,
        handler: (_nuxtApp: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>,
        options?: Record<string, unknown>,
      ): UseAsyncDataStub => {
        return {
          key,
          options,
          run(signal = new AbortController().signal) {
            return handler({}, { signal })
          },
        }
      },
    )
    const useEndpoint = createUseEndpoint(
      [{ path: '/api/users/:id', method: 'get' }],
      useAsyncDataMock,
    )

    const state = useEndpoint('/api/users/:id', {
      method: 'get',
      params: { id: 123 },
      watch: false,
    }) as UseAsyncDataStub

    expect(state.key).toBe('$endpoint:get:/api/users/:id:{"params":{"id":123}}')
    expect(state.options).toEqual({ watch: [] })
  })

  it('returns serializable status data from useEndpoint', async () => {
    fetchRawMock.mockResolvedValue({
      status: 404,
      ok: false,
      headers: new Headers({ 'x-request-id': 'req-1' }),
      _data: { message: 'Not found' },
    })

    const useAsyncDataMock = vi.fn(
      (
        key: string,
        handler: (_nuxtApp: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>,
        options?: Record<string, unknown>,
      ): UseAsyncDataStub => {
        return {
          key,
          options,
          run(signal = new AbortController().signal) {
            return handler({}, { signal })
          },
        }
      },
    )
    const useEndpoint = createUseEndpoint(
      [{ path: '/api/users/:id', method: 'get' }],
      useAsyncDataMock,
    )

    const state = useEndpoint('/api/users/:id', {
      method: 'get',
      params: { id: 404 },
      lazy: true,
    }) as UseAsyncDataStub

    expect(state.key).toBe('$endpoint:get:/api/users/:id:{"params":{"id":404}}')
    expect(state.options).toEqual({ lazy: true })
    await expect(state.run()).resolves.toEqual({
      status: 404,
      ok: false,
      body: { message: 'Not found' },
    })
    expect(fetchRawMock).toHaveBeenCalledWith('/api/users/404', {
      method: 'get',
      ignoreResponseError: true,
      signal: expect.any(AbortSignal),
    })
  })

  // `useFetch` swaps plain `$fetch` for `useRequestFetch()` on relative paths
  // during SSR, so the incoming cookies reach the internal route. The
  // composables that stand in for it capture the same request-aware fetcher;
  // `$endpoint` stands in for `$fetch` and deliberately does not.
  describe('request-aware fetcher capture', () => {
    const routes = [{ path: '/api/users/:id', method: 'get' }] as const

    function createUseAsyncDataStub() {
      return vi.fn(
        (
          key: string,
          handler: (_nuxtApp: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>,
        ): UseAsyncDataStub => ({
          key,
          run: (signal = new AbortController().signal) => handler({}, { signal }),
        }),
      )
    }

    function createFetcher(data: ReturnType<typeof vi.fn>) {
      return Object.assign(data, {
        raw: vi.fn(async (path: string, options: Record<string, unknown> = {}) => {
          const { ignoreResponseError: _ignoreResponseError, ...dataOptions } = options
          return {
            status: 200,
            ok: true,
            headers: new Headers(),
            _data: await data(path, dataOptions),
          }
        }),
      }) as never
    }

    it('uses the value returned by captureFetcher', async () => {
      const capturedData = vi.fn().mockResolvedValue({ id: 5, name: 'Captured' })
      const useEndpoint = createUseEndpoint(routes, createUseAsyncDataStub(), {
        captureFetcher: () => createFetcher(capturedData),
      })

      const state = useEndpoint('/api/users/:id', {
        method: 'get',
        params: { id: 5 },
      }) as UseAsyncDataStub
      await state.run()

      expect(capturedData).toHaveBeenCalledWith('/api/users/5', {
        method: 'get',
        signal: expect.any(AbortSignal),
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('prefers an explicit fetcher over captureFetcher', async () => {
      const explicitData = vi.fn().mockResolvedValue({ id: 1 })
      const captureData = vi.fn().mockResolvedValue({ id: 2 })
      const useEndpoint = createUseEndpoint(routes, createUseAsyncDataStub(), {
        fetcher: createFetcher(explicitData),
        captureFetcher: () => createFetcher(captureData),
      })

      const state = useEndpoint('/api/users/:id', {
        method: 'get',
        params: { id: 1 },
      }) as UseAsyncDataStub
      await state.run()

      expect(explicitData).toHaveBeenCalled()
      expect(captureData).not.toHaveBeenCalled()
    })

    // Outside a Nuxt request context the generated `captureFetcher` returns
    // undefined rather than throwing, so the call still goes out — on plain
    // `$fetch`, exactly as before this capture existed.
    it('falls back to $fetch when captureFetcher returns undefined', async () => {
      fetchMock.mockResolvedValue({ id: 3 })
      const useEndpoint = createUseEndpoint(routes, createUseAsyncDataStub(), {
        captureFetcher: () => undefined,
      })

      const state = useEndpoint('/api/users/:id', {
        method: 'get',
        params: { id: 3 },
      }) as UseAsyncDataStub
      await state.run()

      expect(fetchMock).toHaveBeenCalledWith('/api/users/3', {
        method: 'get',
        signal: expect.any(AbortSignal),
      })
    })

    // The fetcher belongs to the request, so a module-scope client reused
    // across concurrent SSR requests must re-capture per call. Capturing once
    // at creation would serve request B with request A's cookies.
    it('re-captures per composable call rather than once at creation', async () => {
      const firstData = vi.fn().mockResolvedValue({ from: 'A' })
      const secondData = vi.fn().mockResolvedValue({ from: 'B' })
      let current = createFetcher(firstData)
      const useEndpoint = createUseEndpoint(routes, createUseAsyncDataStub(), {
        captureFetcher: () => current,
      })

      await (
        useEndpoint('/api/users/:id', { method: 'get', params: { id: 1 } }) as UseAsyncDataStub
      ).run()
      current = createFetcher(secondData)
      await (
        useEndpoint('/api/users/:id', { method: 'get', params: { id: 2 } }) as UseAsyncDataStub
      ).run()

      expect(firstData).toHaveBeenCalledTimes(1)
      expect(secondData).toHaveBeenCalledTimes(1)
    })

    it('leaves direct $endpoint awaits on $fetch and captures its query function', async () => {
      fetchMock.mockResolvedValue({ id: 9 })
      const captured = vi.fn().mockResolvedValue({ id: 10 })
      const client = createEndpointClient(routes, {
        captureFetcher: () => createFetcher(captured),
      })

      const direct = client('/api/users/:id', { method: 'get', params: { id: 9 } })
      await direct

      expect(fetchMock).toHaveBeenCalledWith('/api/users/9', {
        method: 'get',
      })
      expect(captured).not.toHaveBeenCalled()

      await queryOptions(direct).query({ signal: new AbortController().signal })
      expect(captured).toHaveBeenCalledWith('/api/users/9', {
        method: 'get',
        signal: expect.any(AbortSignal),
      })
    })
  })
})
