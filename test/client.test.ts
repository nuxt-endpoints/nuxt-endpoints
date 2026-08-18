import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEndpointClient, createUseEndpoint, createUseEndpointResult } from '../src/runtime'
import { Effect } from 'effect'
import { createEndpointEffectExtension, createUseEndpointEffect } from '../src/runtime/effect'

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

  it('attaches Effect calls through the effect extension', async () => {
    fetchRawMock.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      ok: true,
      headers: new Headers({ 'x-request-id': 'req-1' }),
      _data: { id: 123, name: 'Tom' },
    })

    const client = createEndpointClient(
      {
        getUser: { path: '/api/users/:id', method: 'get' },
      },
      { extensions: [createEndpointEffectExtension()] },
    )

    const call = client('getUser', { params: { id: 123 } }) as ReturnType<typeof client> & {
      effect: () => Effect.Effect<unknown>
    }
    const program = call.effect()

    expect(fetchRawMock).not.toHaveBeenCalled()

    const result = await Effect.runPromise(program)

    expect(result).toEqual({
      status: 200,
      ok: true,
      headers: expect.any(Headers),
      body: { id: 123, name: 'Tom' },
    })
  })

  it('does not add extra Effect methods for optional client shapes', () => {
    const client = createEndpointClient(
      {
        getUser: { path: '/api/users/:id', method: 'get' },
      },
      {
        features: { result: false, raw: false },
        extensions: [createEndpointEffectExtension()],
      },
    )

    const call = client('getUser', { params: { id: 123 } }) as ReturnType<typeof client> & {
      effect?: () => Effect.Effect<unknown>
      resultEffect?: () => Effect.Effect<unknown>
      rawEffect?: () => Effect.Effect<Response>
    }

    expect(call.effect).toBeTypeOf('function')
    expect(call.resultEffect).toBeUndefined()
    expect(call.rawEffect).toBeUndefined()
  })

  it('returns non-success statuses as Effect result values', async () => {
    fetchRawMock.mockResolvedValue({
      status: 404,
      ok: false,
      headers: new Headers(),
      _data: { message: 'Not found' },
    })

    const client = createEndpointClient(
      {
        getUser: { path: '/api/users/:id', method: 'get' },
      },
      { extensions: [createEndpointEffectExtension()] },
    )

    const call = client('getUser', { params: { id: 404 } }) as ReturnType<typeof client> & {
      effect: () => Effect.Effect<unknown>
    }

    const result = await Effect.runPromise(call.effect())

    expect(result).toMatchObject({
      status: 404,
      ok: false,
      body: { message: 'Not found' },
    })
  })

  it('reruns Effect requests when Effect retries the call', async () => {
    fetchRawMock.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers(),
      _data: { id: 123, name: 'Tom' },
    })

    const client = createEndpointClient(
      {
        getUser: { path: '/api/users/:id', method: 'get' },
      },
      { extensions: [createEndpointEffectExtension()] },
    )

    const call = client('getUser', { params: { id: 123 } }) as ReturnType<typeof client> & {
      effect: () => Effect.Effect<unknown>
    }
    const result = await Effect.runPromise(call.effect().pipe(Effect.retry({ times: 1 })))

    expect(result).toEqual({
      status: 200,
      ok: true,
      headers: expect.any(Headers),
      body: { id: 123, name: 'Tom' },
    })
    expect(fetchRawMock).toHaveBeenCalledTimes(2)
    expect(fetchRawMock).toHaveBeenNthCalledWith(
      1,
      '/api/users/123',
      expect.objectContaining({
        method: 'get',
        ignoreResponseError: true,
        signal: expect.any(AbortSignal),
      }),
    )
    expect(fetchRawMock).toHaveBeenNthCalledWith(
      2,
      '/api/users/123',
      expect.objectContaining({
        method: 'get',
        ignoreResponseError: true,
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('runs Effect endpoint programs inside useAsyncData', async () => {
    fetchRawMock.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers(),
      _data: { id: 123, name: 'Tom' },
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
    const useEndpointEffect = createUseEndpointEffect(
      [{ path: '/api/users/:id', method: 'get', operation: 'getUser' }],
      useAsyncDataMock,
      { features: { result: true, raw: true } },
    )

    const state = useEndpointEffect(
      '/api/users/:id',
      {
        method: 'get',
        params: { id: 123 },
        lazy: true,
      },
      (program) =>
        (program as Effect.Effect<{ status: number; body: unknown }>).pipe(
          Effect.retry({ times: 1 }),
          Effect.map((result) => (result.status === 404 ? null : result.body)),
        ),
    ) as UseAsyncDataStub

    expect(state.key).toBe('$endpoint-effect:get:/api/users/:id:{"params":{"id":123}}')
    expect(state.options).toEqual({ lazy: true })
    await expect(state.run()).resolves.toEqual({ id: 123, name: 'Tom' })
    expect(fetchRawMock).toHaveBeenCalledTimes(2)
    expect(fetchRawMock).toHaveBeenLastCalledWith(
      '/api/users/123',
      expect.objectContaining({
        method: 'get',
        ignoreResponseError: true,
        signal: expect.any(AbortSignal),
      }),
    )

    fetchRawMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers(),
      _data: { id: 123, name: 'Tom' },
    })

    const operationState = useEndpointEffect('getUser', { params: { id: 123 } }, (program) =>
      (program as Effect.Effect<{ status: number; body: unknown }>).pipe(
        Effect.map((result) => result.body),
      ),
    ) as UseAsyncDataStub

    await expect(operationState.run()).resolves.toEqual({ id: 123, name: 'Tom' })
  })
})
