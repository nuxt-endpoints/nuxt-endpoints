import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEndpointClient, createUseEndpoint, createUseEndpointResult } from '../src/runtime'

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
    vi.stubGlobal('$fetch', Object.assign(fetchMock, { raw: fetchRawMock }))
  })

  it('replaces path params and forwards fetch options', async () => {
    fetchMock.mockResolvedValue({ id: 123, name: 'Tom' })

    const client = createEndpointClient([
      { path: '/api/users/:id', method: 'get', operation: 'getUser' },
    ])

    await client('/api/users/:id', {
      method: 'get',
      params: { id: 123 },
      query: { include: 'profile' },
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/users/123', {
      query: { include: 'profile' },
      method: 'get',
    })

    await client('getUser', {
      params: { id: 456 },
    })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/users/456', {
      method: 'get',
    })

    await (
      client as typeof client & {
        getUser: (options: Record<string, unknown>) => PromiseLike<unknown>
      }
    ).getUser({
      params: { id: 789 },
    })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/users/789', {
      method: 'get',
    })
  })

  it('allows operation names that match HTTP methods', async () => {
    fetchMock.mockResolvedValue({ id: 123, name: 'Tom' })

    const client = createEndpointClient([
      { path: '/api/users/:id', method: 'get', operation: 'get' },
    ])

    await client('/api/users/:id', {
      method: 'get',
      params: { id: 123 },
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/users/123', {
      method: 'get',
    })

    await client('get', {
      params: { id: 456 },
    })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/users/456', {
      method: 'get',
    })
  })

  it('returns typed status data through result calls', async () => {
    const headers = new Headers({ 'x-request-id': 'req-1' })
    fetchRawMock.mockResolvedValue({
      status: 404,
      ok: false,
      headers,
      _data: { message: 'Not found' },
    })

    const client = createEndpointClient([
      { path: '/api/users/:id', method: 'get', operation: 'getUser' },
    ])

    const response = await client('/api/users/:id', {
      method: 'get',
      params: { id: 404 },
      query: { include: 'profile' },
    }).result()

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

    const client = createEndpointClient([
      { path: '/api/users/:id', method: 'get', operation: 'getUser' },
    ])

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

  it('omits optional client methods when disabled', () => {
    const client = createEndpointClient(
      {
        getUser: { path: '/api/users/:id', method: 'get' },
      },
      { features: { result: false, raw: false } },
    )

    const call = client('getUser', { params: { id: 123 } })

    expect(call.result).toBeUndefined()
    expect(call.raw).toBeUndefined()
  })

  it('throws when a path parameter is missing', () => {
    const client = createEndpointClient([
      { path: '/api/users/:id', method: 'get', operation: 'getUser' },
    ])

    expect(() => client('getUser', { params: {} })).toThrow(/Missing path parameter "id"/)
  })

  it('maps idempotencyKey to the generated route header without leaking the option', async () => {
    fetchMock.mockResolvedValue({ id: 1 })
    const client = createEndpointClient([
      {
        path: '/api/items',
        method: 'post',
        operation: 'createItem',
        idempotency: { headerName: 'X-Request-Key', required: true },
      },
    ])

    await client('createItem', { idempotencyKey: 'request-1', body: { amount: 100 } })

    expect(fetchMock).toHaveBeenCalledWith('/api/items', {
      body: { amount: 100 },
      headers: { 'X-Request-Key': 'request-1' },
      method: 'post',
    })
  })

  it('enforces generated idempotency metadata for untyped callers', async () => {
    const requiredClient = createEndpointClient([
      {
        path: '/api/items',
        method: 'post',
        operation: 'createItem',
        idempotency: { headerName: 'Idempotency-Key', required: true },
      },
    ])

    expect(() => requiredClient('createItem')).toThrow(/idempotencyKey is required/i)
    expect(() => requiredClient('createItem', { idempotencyKey: '' })).toThrow(/non-empty string/i)
    expect(() => requiredClient('createItem', { idempotencyKey: 'one,two' })).toThrow(
      /without commas/i,
    )
    expect(() => requiredClient('createItem', { idempotencyKey: 'line\nbreak' })).toThrow(
      /control characters/i,
    )
    expect(() =>
      requiredClient('createItem', {
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
        operation: 'createItem',
        idempotency: { headerName: 'Idempotency-Key', required: true },
      },
    ])

    await client('createItem', {
      idempotencyKey: 'request-1',
      headers: new Headers({ 'x-trace': 'trace-1' }),
    })
    const sentHeaders = fetchMock.mock.calls[0]![1].headers as Headers
    expect(sentHeaders).toBeInstanceOf(Headers)
    expect(sentHeaders.get('idempotency-key')).toBe('request-1')
    expect(sentHeaders.get('x-trace')).toBe('trace-1')

    expect(() =>
      client('createItem', {
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
        operation: 'check',
        idempotency: { headerName: 'Idempotency-Key', required: false },
      },
    ])

    await client('check')
    await client('check', { idempotencyKey: 'request-1' })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/check', { method: 'post' })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/check', {
      headers: { 'Idempotency-Key': 'request-1' },
      method: 'post',
    })
  })

  describe('mediaType body options', () => {
    it('does not set a content-type header for a multipart/form-data mediaType', async () => {
      fetchMock.mockResolvedValue({ ok: true })
      const client = createEndpointClient([
        { path: '/api/upload', method: 'post', operation: 'uploadFile' },
      ])
      const formData = new FormData()
      formData.append('name', 'Tom')

      await client('uploadFile', { mediaType: 'multipart/form-data', body: formData })

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
      const client = createEndpointClient([
        { path: '/api/notes', method: 'post', operation: 'createNote' },
      ])
      const params = new URLSearchParams({ note: 'hi' })

      await client('createNote', {
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
      const client = createEndpointClient([
        { path: '/api/notes', method: 'post', operation: 'createNote' },
      ])

      await client('createNote', {
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
      const client = createEndpointClient([
        { path: '/api/notes', method: 'post', operation: 'createNote' },
      ])

      await client('createNote', { mediaType: 'application/json', body: { note: 'hi' } })

      const calledOptions = fetchMock.mock.calls[0]![1] as Record<string, unknown>
      expect(calledOptions).not.toHaveProperty('mediaType')
      expect(calledOptions).toEqual({
        body: { note: 'hi' },
        method: 'post',
        headers: { 'content-type': 'application/json' },
      })
    })

    it('throws when mediaType is not a string', () => {
      const client = createEndpointClient([
        { path: '/api/notes', method: 'post', operation: 'createNote' },
      ])

      expect(() =>
        client('createNote', { mediaType: 123 as unknown as string, body: 'x' }),
      ).toThrow(/mediaType option must be a string/)
    })
  })

  describe('media response routes', () => {
    it('sets responseType: stream in the fetcher options for a media response route', async () => {
      fetchMock.mockResolvedValue(new ReadableStream())
      const client = createEndpointClient([
        { path: '/api/export', method: 'get', operation: 'exportUsers', mediaResponse: true },
      ])

      await client('exportUsers')

      expect(fetchMock).toHaveBeenCalledWith('/api/export', {
        method: 'get',
        responseType: 'stream',
      })
    })

    it('does not set responseType for a route without a media response', async () => {
      fetchMock.mockResolvedValue({ id: 123, name: 'Tom' })
      const client = createEndpointClient([
        { path: '/api/users/:id', method: 'get', operation: 'getUser' },
      ])

      await client('getUser', { params: { id: 123 } })

      const calledOptions = fetchMock.mock.calls[0]![1] as Record<string, unknown>
      expect(calledOptions).not.toHaveProperty('responseType')
    })

    it('preserves an explicit caller responseType over the stream default', async () => {
      fetchMock.mockResolvedValue(new Blob())
      const client = createEndpointClient([
        { path: '/api/export', method: 'get', operation: 'exportUsers', mediaResponse: true },
      ])

      await client('exportUsers', { responseType: 'blob' })

      expect(fetchMock).toHaveBeenCalledWith('/api/export', {
        method: 'get',
        responseType: 'blob',
      })
    })

    it('sends the accept option as the accept header without leaking it to the fetcher', async () => {
      fetchMock.mockResolvedValue(new ReadableStream())
      const client = createEndpointClient([
        { path: '/api/export', method: 'get', operation: 'exportUsers', mediaResponse: true },
      ])

      await client('exportUsers', { accept: 'application/json' })

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
        { path: '/api/export', method: 'get', operation: 'exportUsers', mediaResponse: true },
      ])

      await client('exportUsers', {
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
        { path: '/api/export', method: 'get', operation: 'exportUsers', mediaResponse: true },
      ])

      // Rejected rather than ignored, like its sibling selectors: a dropped
      // `accept` comes back as the wrong representation, which is harder to
      // trace than a throw.
      expect(() => client('exportUsers', { accept: 123 })).toThrow(
        /accept option must be a non-empty string/,
      )
      expect(() => client('exportUsers', { accept: '  ' })).toThrow(
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
          operation: 'createExport',
          mediaResponse: true,
          idempotency: { headerName: 'Idempotency-Key', required: true },
        },
      ])

      await client('createExport', {
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
        { path: '/api/export', method: 'get', operation: 'exportUsers', mediaResponse: true },
      ])

      await client('exportUsers', {
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
      [{ path: '/api/users/:id', method: 'get', operation: 'getUser' }],
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

    const operationState = useEndpoint('getUser', {
      params: { id: 456 },
      lazy: true,
    }) as UseAsyncDataStub

    expect(operationState.key).toBe('$endpoint:get:/api/users/:id:{"params":{"id":456}}')
    expect(operationState.options).toEqual({ lazy: true })
    await operationState.run(signal)

    expect(fetchMock).toHaveBeenLastCalledWith('/api/users/456', {
      method: 'get',
      signal,
    })

    expect(() => {
      useEndpoint('getUser', { method: 'get', params: { id: 123 } })
    }).toThrow('Endpoint operation calls do not take a method: getUser')
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

  it('wraps typed result calls with serializable useAsyncData state', async () => {
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
    const useEndpointResult = createUseEndpointResult(
      [{ path: '/api/users/:id', method: 'get', operation: 'getUser' }],
      useAsyncDataMock,
    )

    const state = useEndpointResult('/api/users/:id', {
      method: 'get',
      params: { id: 404 },
      lazy: true,
    }) as UseAsyncDataStub

    expect(state.key).toBe('$endpoint-result:get:/api/users/:id:{"params":{"id":404}}')
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

    const operationState = useEndpointResult('getUser', {
      params: { id: 404 },
    }) as UseAsyncDataStub

    await expect(operationState.run()).resolves.toEqual({
      status: 404,
      ok: false,
      body: { message: 'Not found' },
    })
  })
})
