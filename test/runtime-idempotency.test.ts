import { describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import {
  createMemoryIdempotencyStorage,
  defineEndpoint,
  defineEndpointHandler,
} from './internal-runtime'
import type { EndpointEventHandler, StandardSchemaLike } from './internal-runtime'

vi.mock('h3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('h3')>()),
  defineHandler: (handler: unknown) => handler,
  // h3 v2's thrown error carries `status`/`statusText` rather than v1's
  // `statusCode`/`statusMessage`; this fake mirrors that shape so it reads
  // back the same fields `createRuntimeError` sets.
  HTTPError: class HTTPError extends Error {
    status: number
    statusText?: string
    data?: unknown
    constructor(options: {
      status: number
      statusText?: string
      message?: string
      data?: unknown
    }) {
      super(options.message)
      this.status = options.status
      this.statusText = options.statusText
      this.data = options.data
    }
  },
  getQuery: (event: H3Event) => event.context.query ?? {},
  readBody: async (event: H3Event) => event.context.body,
}))

const jsonRecord: StandardSchemaLike<Record<string, unknown>> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate(input: unknown) {
      return { value: input as Record<string, unknown> }
    },
  },
}

const positiveIdResponse: StandardSchemaLike<unknown, { id: number }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate(input: unknown) {
      const value = input as { id?: unknown }
      return typeof value.id === 'number' && value.id > 0
        ? { value: { id: value.id } }
        : { issues: [{ message: 'id must be positive' }] }
    },
  },
}

describe('endpoint idempotency runtime', () => {
  it('configures immutable, client-safe definition metadata', () => {
    const storage = createMemoryIdempotencyStorage()
    const base = defineEndpoint({ body: jsonRecord })
    const configured = base.idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: 'middleware',
      headerName: 'X-Request-Key',
      required: true,
    })

    expect(base.definition).not.toHaveProperty('idempotency')
    expect(configured.definition.idempotency).toEqual({
      enabled: true,
      headerName: 'X-Request-Key',
      required: true,
    })
  })

  it('defaults to Idempotency-Key/optional metadata and an all-false runtime marker without options', () => {
    const endpoint = defineEndpoint({ body: jsonRecord }).idempotency()
    const handler = defineEndpointHandler(endpoint, () => ({ created: true }))

    expect(endpoint.definition.idempotency).toEqual({
      enabled: true,
      headerName: 'Idempotency-Key',
      required: false,
    })
    expect(handler.__endpoint_contract__.__idempotency_runtime_marker__).toEqual({
      storage: false,
      scope: false,
      authorization: false,
    })
  })

  it('records exactly which runtime options .idempotency() itself received', () => {
    const storage = createMemoryIdempotencyStorage()
    const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({
      storage: () => storage,
      required: true,
    })
    const handler = defineEndpointHandler(endpoint, () => ({ created: true }))

    expect(handler.__endpoint_contract__.__idempotency_runtime_marker__).toEqual({
      storage: true,
      scope: false,
      authorization: false,
    })
  })

  it('bypasses storage when an optional key is absent', async () => {
    const storage = createMemoryIdempotencyStorage()
    const claim = vi.spyOn(storage, 'claim')
    const authorize = vi.fn()
    const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: authorize,
    })
    const handler = defineEndpointHandler(endpoint, () => ({ created: true }))

    await expect(handler(createEvent({ body: { amount: 100 } }))).resolves.toEqual({
      created: true,
    })
    expect(claim).not.toHaveBeenCalled()
    expect(authorize).toHaveBeenCalledOnce()
  })

  it('returns Problem Details for a missing required key and malformed keys', async () => {
    const storage = createMemoryIdempotencyStorage()
    const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: 'middleware',
      required: true,
    })
    const handler = defineEndpointHandler(endpoint, () => ({ created: true }))

    const missingKeyEvent = createEvent({ body: {} })
    await expect(handler(missingKeyEvent)).resolves.toMatchObject({
      status: 400,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    })
    expect(missingKeyEvent.res.headers.get('content-type')).toBe('application/problem+json')

    for (const key of ['', 'one,two', `k${'x'.repeat(255)}`]) {
      await expect(
        handler(createEvent({ body: {}, headers: { 'idempotency-key': key } })),
      ).resolves.toMatchObject({ status: 400, code: 'IDEMPOTENCY_KEY_INVALID' })
    }
  })

  it('authorizes every request and replays a completed response without rerunning the handler', async () => {
    const storage = createMemoryIdempotencyStorage()
    const authorize = vi.fn()
    const execute = vi.fn(() => ({ id: 1 }))
    const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({
      storage: () => storage,
      scope: ({ event }) => String(event.context.tenant),
      authorization: authorize,
      required: true,
    })
    const handler = defineEndpointHandler(endpoint, execute)
    attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })

    const request = () =>
      createEvent({
        body: { amount: 100 },
        headers: { 'idempotency-key': 'request-1' },
        tenant: 'tenant-a',
      })

    await expect(handler(request())).resolves.toEqual({ id: 1 })
    const secondEvent = request()
    await expect(handler(secondEvent)).resolves.toEqual({ id: 1 })

    expect(authorize).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(secondEvent.res.status).toBe(200)
  })

  it('replays a repeated key for a single-define endpoint exactly like the two-call form', async () => {
    const storage = createMemoryIdempotencyStorage()
    const execute = vi.fn(() => ({ id: 1 }))
    const handler = defineEndpoint({
      body: jsonRecord,
      idempotency: {
        storage: () => storage,
        scope: () => 'public',
        authorization: 'middleware',
        required: true,
      },
      handler: execute,
    })
    attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })

    const request = () =>
      createEvent({ body: { amount: 100 }, headers: { 'idempotency-key': 'request-1' } })

    await expect(handler(request())).resolves.toEqual({ id: 1 })
    await expect(handler(request())).resolves.toEqual({ id: 1 })

    expect(execute).toHaveBeenCalledTimes(1)
    // The slot routes through `.idempotency()`, so the metadata and the runtime
    // marker are the same ones the two-call form produces.
    expect(handler.__endpoint_contract__.definition.idempotency).toEqual({
      enabled: true,
      headerName: 'Idempotency-Key',
      required: true,
    })
    expect(handler.__endpoint_contract__.__idempotency_runtime_marker__).toEqual({
      storage: true,
      scope: true,
      authorization: true,
    })
  })

  it('returns the same JSON snapshot on the first response and replay', async () => {
    const storage = createMemoryIdempotencyStorage()
    let serializationCount = 0
    const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: 'middleware',
      required: true,
    })
    const handler = defineEndpointHandler(endpoint, () => ({
      toJSON() {
        serializationCount += 1
        return { version: serializationCount }
      },
    }))
    attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })
    const request = () =>
      createEvent({ body: { amount: 100 }, headers: { 'idempotency-key': 'request-1' } })

    await expect(handler(request())).resolves.toEqual({ version: 1 })
    await expect(handler(request())).resolves.toEqual({ version: 1 })
    expect(serializationCount).toBe(1)
  })

  it('records and replays successful responses without a body', async () => {
    const storage = createMemoryIdempotencyStorage()
    const execute = vi.fn(({ respond }) => respond(204, undefined))
    const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: 'middleware',
      required: true,
    })
    const handler = defineEndpointHandler(endpoint, execute)
    attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })
    const request = () =>
      createEvent({ body: { amount: 100 }, headers: { 'idempotency-key': 'request-1' } })

    await expect(handler(request())).resolves.toBeUndefined()
    const secondEvent = request()
    await expect(handler(secondEvent)).resolves.toBeUndefined()
    expect(execute).toHaveBeenCalledOnce()
    expect(secondEvent.res.status).toBe(204)
  })

  it('rejects reuse with a different validated request fingerprint', async () => {
    const storage = createMemoryIdempotencyStorage()
    const execute = vi.fn(() => ({ id: 1 }))
    const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: 'middleware',
      required: true,
    })
    const handler = defineEndpointHandler(endpoint, execute)
    attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })

    await handler(
      createEvent({ body: { amount: 100 }, headers: { 'idempotency-key': 'request-1' } }),
    )
    await expect(
      handler(createEvent({ body: { amount: 200 }, headers: { 'idempotency-key': 'request-1' } })),
    ).resolves.toMatchObject({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('rejects reuse when the same key asks for a different representation', async () => {
    const storage = createMemoryIdempotencyStorage()
    const execute = vi.fn(({ responseMediaType, respond }) =>
      respond(200, responseMediaType === 'text/csv' ? 'id\n1\n' : '{"id":1}'),
    )
    const endpoint = defineEndpoint({
      body: jsonRecord,
      responses: { 200: { media: ['text/csv', 'application/json'] } },
    }).idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: 'middleware',
      required: true,
    })
    const handler = defineEndpointHandler(endpoint, execute)
    attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })
    const request = (accept: string) =>
      createEvent({
        body: { amount: 100 },
        headers: { 'idempotency-key': 'request-1', accept },
      })

    await expect(handler(request('text/csv'))).resolves.toBe('id\n1\n')
    // The handler branches on the negotiated type, so a retry asking for the
    // other representation is a different request - not one to replay the CSV to.
    await expect(handler(request('application/json'))).resolves.toMatchObject({
      status: 422,
      code: 'IDEMPOTENCY_KEY_REUSED',
    })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('replays when the same key asks for the same representation', async () => {
    const storage = createMemoryIdempotencyStorage()
    const execute = vi.fn(({ respond }) => respond(200, 'id\n1\n'))
    const endpoint = defineEndpoint({
      body: jsonRecord,
      responses: { 200: { media: ['text/csv', 'application/json'] } },
    }).idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: 'middleware',
      required: true,
    })
    const handler = defineEndpointHandler(endpoint, execute)
    attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })
    const request = () =>
      createEvent({
        body: { amount: 100 },
        headers: { 'idempotency-key': 'request-1', accept: 'text/csv' },
      })

    await expect(handler(request())).resolves.toBe('id\n1\n')
    await expect(handler(request())).resolves.toBe('id\n1\n')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('keeps the fingerprint unchanged for an endpoint that declares one representation', async () => {
    const storage = createMemoryIdempotencyStorage()
    const execute = vi.fn(({ respond }) => respond(200, 'id\n1\n'))
    const endpoint = defineEndpoint({
      body: jsonRecord,
      responses: { 200: { media: 'text/csv' } },
    }).idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: 'middleware',
      required: true,
    })
    const handler = defineEndpointHandler(endpoint, execute)
    attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })

    // Nothing negotiates here, so `Accept` is not part of identity and a retry
    // that sends a different one still replays.
    await handler(
      createEvent({
        body: { amount: 100 },
        headers: { 'idempotency-key': 'request-1', accept: 'text/csv' },
      }),
    )
    await expect(
      handler(
        createEvent({
          body: { amount: 100 },
          headers: { 'idempotency-key': 'request-1', accept: '*/*' },
        }),
      ),
    ).resolves.toBe('id\n1\n')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('includes application-selected validated headers in a custom fingerprint', async () => {
    const storage = createMemoryIdempotencyStorage()
    const execute = vi.fn(() => ({ id: 1 }))
    const endpoint = defineEndpoint({ body: jsonRecord, headers: jsonRecord }).idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: 'middleware',
      required: true,
      fingerprint: ({ body, headers }) => ({
        body,
        currency: headers['x-currency'],
      }),
    })
    const handler = defineEndpointHandler(endpoint, execute)
    attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })

    await handler(
      createEvent({
        body: { amount: 100 },
        headers: { 'idempotency-key': 'request-1', 'x-currency': 'JPY' },
      }),
    )
    await expect(
      handler(
        createEvent({
          body: { amount: 100 },
          headers: { 'idempotency-key': 'request-1', 'x-currency': 'USD' },
        }),
      ),
    ).resolves.toMatchObject({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('returns an in-flight conflict while the lease owner is running', async () => {
    const storage = createMemoryIdempotencyStorage()
    const entered = deferred<void>()
    const finish = deferred<void>()
    const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: 'middleware',
      required: true,
    })
    const handler = defineEndpointHandler(endpoint, async () => {
      entered.resolve()
      await finish.promise
      return { id: 1 }
    })
    attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })
    const request = () =>
      createEvent({ body: { amount: 100 }, headers: { 'idempotency-key': 'request-1' } })

    const first = handler(request())
    await entered.promise
    await expect(handler(request())).resolves.toMatchObject({
      status: 409,
      code: 'IDEMPOTENCY_REQUEST_IN_FLIGHT',
    })
    finish.resolve()
    await expect(first).resolves.toEqual({ id: 1 })
  })

  it('isolates the same client key by trusted scope', async () => {
    const storage = createMemoryIdempotencyStorage()
    const execute = vi.fn(({ event }: { event: H3Event }) => ({ tenant: event.context.tenant }))
    const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({
      storage: () => storage,
      scope: ({ event }) => String(event.context.tenant),
      authorization: 'middleware',
      required: true,
    })
    const handler = defineEndpointHandler(endpoint, execute)
    attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })

    for (const tenant of ['tenant-a', 'tenant-b']) {
      await expect(
        handler(
          createEvent({
            body: { amount: 100 },
            headers: { 'idempotency-key': 'shared-key' },
            tenant,
          }),
        ),
      ).resolves.toEqual({ tenant })
    }
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('releases the lease when the handler throws so a retry can execute', async () => {
    const storage = createMemoryIdempotencyStorage()
    const execute = vi
      .fn<() => { id: number }>()
      .mockImplementationOnce(() => {
        throw new Error('failed after claim')
      })
      .mockReturnValue({ id: 1 })
    const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: 'middleware',
      required: true,
    })
    const handler = defineEndpointHandler(endpoint, execute)
    attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })
    const request = () =>
      createEvent({ body: { amount: 100 }, headers: { 'idempotency-key': 'request-1' } })

    await expect(handler(request())).rejects.toThrow('failed after claim')
    await expect(handler(request())).resolves.toEqual({ id: 1 })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('releases the lease when response validation fails', async () => {
    const storage = createMemoryIdempotencyStorage()
    const execute = vi
      .fn<() => { id: number }>()
      .mockReturnValueOnce({ id: -1 })
      .mockReturnValue({ id: 1 })
    const endpoint = defineEndpoint(
      { body: jsonRecord, responses: { 200: positiveIdResponse } },
      { validation: { response: true } },
    ).idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: 'middleware',
      required: true,
    })
    const handler = defineEndpointHandler(endpoint, execute)
    attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })
    const request = () =>
      createEvent({ body: { amount: 100 }, headers: { 'idempotency-key': 'request-1' } })

    // h3 v2's error wire shape uses `status`/`statusText`, not v1's
    // `statusCode`/`statusMessage`.
    await expect(handler(request())).rejects.toMatchObject({
      status: 500,
      statusText: 'Response Contract Error',
    })
    await expect(handler(request())).resolves.toEqual({ id: 1 })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('releases instead of recording unsupported native Response values', async () => {
    const storage = createMemoryIdempotencyStorage()
    const execute = vi.fn(() => new Response(null, { status: 204 }))
    const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: 'middleware',
      required: true,
    })
    const handler = defineEndpointHandler(endpoint, execute)
    attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })
    const request = () =>
      createEvent({ body: { amount: 100 }, headers: { 'idempotency-key': 'request-1' } })

    // h3 v2's error wire shape uses `status`/`statusText`, not v1's
    // `statusCode`/`statusMessage`.
    await expect(handler(request())).rejects.toMatchObject({
      status: 500,
      statusText: 'Idempotency Response Serialization Error',
    })
    await expect(handler(request())).rejects.toMatchObject({ status: 500 })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('does not record non-success responses unless they are explicitly selected', async () => {
    const storage = createMemoryIdempotencyStorage()
    const execute = vi.fn(({ respond }) => respond(409, { message: 'Try again' }))
    const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: 'middleware',
      required: true,
    })
    const handler = defineEndpointHandler(endpoint, execute)
    attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })
    const request = () =>
      createEvent({ body: { amount: 100 }, headers: { 'idempotency-key': 'request-1' } })

    await handler(request())
    await handler(request())
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('returns a conflict when the lease expires before completion', async () => {
    const delegate = createMemoryIdempotencyStorage()
    const storage = {
      claim: delegate.claim.bind(delegate),
      release: delegate.release.bind(delegate),
      complete: vi.fn(async () => ({ outcome: 'lease-lost' as const })),
    }
    const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: 'middleware',
      required: true,
    })
    const handler = defineEndpointHandler(endpoint, () => ({ id: 1 }))
    attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })

    await expect(
      handler(createEvent({ body: { amount: 100 }, headers: { 'idempotency-key': 'request-1' } })),
    ).resolves.toMatchObject({ status: 409, code: 'IDEMPOTENCY_LEASE_LOST' })
  })

  it('replays only safe response headers and can opt a non-success status into replay', async () => {
    const storage = createMemoryIdempotencyStorage()
    const execute = vi.fn(({ respond }) =>
      respond(
        409,
        { message: 'Already submitted' },
        {
          headers: {
            location: '/api/items/1',
            etag: 'item-1',
            'set-cookie': 'session=secret',
            'x-private': 'secret',
          },
        },
      ),
    )
    const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: 'middleware',
      required: true,
      replayStatuses: [409],
    })
    const handler = defineEndpointHandler(endpoint, execute)
    attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })
    const request = () =>
      createEvent({ body: { amount: 100 }, headers: { 'idempotency-key': 'request-1' } })

    await handler(request())
    const secondEvent = request()
    await expect(handler(secondEvent)).resolves.toEqual({ message: 'Already submitted' })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(Object.fromEntries(secondEvent.res.headers.entries())).toEqual({
      location: '/api/items/1',
      etag: 'item-1',
    })
    expect(secondEvent.res.status).toBe(409)
  })

  it('refuses keyed execution without injected route metadata and duplicate route identities', async () => {
    const storage = createMemoryIdempotencyStorage()
    const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: 'middleware',
      required: true,
    })
    const handler = defineEndpointHandler(endpoint, () => ({ id: 1 }))
    const event = createEvent({ body: {}, headers: { 'idempotency-key': 'request-1' } })

    // h3 v2's error wire shape uses `status`/`statusText`, not v1's
    // `statusCode`/`statusMessage`.
    await expect(handler(event)).rejects.toMatchObject({
      status: 500,
      statusText: 'Idempotency Route Metadata Error',
    })

    attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })
    expect(() =>
      attachRoute(handler, { method: 'post', routeTemplate: '/api/other-items' }),
    ).toThrow(/multiple route identities/i)
  })

  describe('central policy injection', () => {
    it('applies route fingerprint, replay statuses, and TTL overrides before the central policy', async () => {
      const storage = createMemoryIdempotencyStorage()
      const claim = vi.spyOn(storage, 'claim')
      const complete = vi.spyOn(storage, 'complete')
      const execute = vi.fn(({ body, respond }) =>
        respond(409, { acceptedAmount: (body as { amount: number }).amount }),
      )
      const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({ required: true })
      const handler = defineEndpointHandler(endpoint, execute)
      attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })
      handler.__set_endpoint_runtime__(
        {
          idempotency: {
            storage: () => storage,
            scope: () => 'public',
            authorization: 'middleware',
            leaseTtlMs: 90_000,
            replayTtlMs: 91_000,
          },
        },
        {
          idempotency: {
            fingerprint: () => ({ logicalOperation: 'one' }),
            replayStatuses: [409],
            leaseTtlMs: 1_234,
            replayTtlMs: 5_678,
          },
        },
      )

      const request = (amount: number) =>
        createEvent({ body: { amount }, headers: { 'idempotency-key': 'request-1' } })
      await expect(handler(request(100))).resolves.toEqual({ acceptedAmount: 100 })
      const replayEvent = request(200)
      await expect(handler(replayEvent)).resolves.toEqual({ acceptedAmount: 100 })

      expect(execute).toHaveBeenCalledOnce()
      expect(claim).toHaveBeenCalledWith(expect.objectContaining({ leaseTtlMs: 1_234 }))
      expect(complete).toHaveBeenCalledWith(expect.objectContaining({ replayTtlMs: 5_678 }))
      expect(replayEvent.res.status).toBe(409)
    })

    it('uses the injected policy entirely when the endpoint supplies no runtime options', async () => {
      const storage = createMemoryIdempotencyStorage()
      const authorize = vi.fn()
      const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({ required: true })
      const handler = defineEndpointHandler(endpoint, () => ({ id: 1 }))
      attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })
      handler.__set_endpoint_runtime__({
        idempotency: {
          storage: () => storage,
          scope: () => 'public',
          authorization: authorize,
        },
      })

      await expect(
        handler(
          createEvent({ body: { amount: 100 }, headers: { 'idempotency-key': 'request-1' } }),
        ),
      ).resolves.toEqual({ id: 1 })
      expect(authorize).toHaveBeenCalledOnce()
    })

    it('prefers the endpoint storage resolver over the central policy', async () => {
      const endpointStorage = createMemoryIdempotencyStorage()
      const policyStorage = createMemoryIdempotencyStorage()
      const endpointClaim = vi.spyOn(endpointStorage, 'claim')
      const policyClaim = vi.spyOn(policyStorage, 'claim')
      const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({
        storage: () => endpointStorage,
        scope: () => 'public',
        authorization: 'middleware',
        required: true,
      })
      const handler = defineEndpointHandler(endpoint, () => ({ id: 1 }))
      attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })
      handler.__set_endpoint_runtime__({
        idempotency: {
          storage: () => policyStorage,
          scope: () => 'public',
          authorization: 'middleware',
        },
      })

      await expect(
        handler(
          createEvent({ body: { amount: 100 }, headers: { 'idempotency-key': 'request-1' } }),
        ),
      ).resolves.toEqual({ id: 1 })
      expect(endpointClaim).toHaveBeenCalledOnce()
      expect(policyClaim).not.toHaveBeenCalled()
    })

    it('prefers the endpoint leaseTtlMs over the central policy', async () => {
      const storage = createMemoryIdempotencyStorage()
      const claim = vi.spyOn(storage, 'claim')
      const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({
        storage: () => storage,
        scope: () => 'public',
        authorization: 'middleware',
        required: true,
        leaseTtlMs: 5_000,
      })
      const handler = defineEndpointHandler(endpoint, () => ({ id: 1 }))
      attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })
      handler.__set_endpoint_runtime__({
        idempotency: {
          storage: () => storage,
          scope: () => 'public',
          authorization: 'middleware',
          leaseTtlMs: 99_000,
        },
      })

      await handler(
        createEvent({ body: { amount: 100 }, headers: { 'idempotency-key': 'request-1' } }),
      )
      expect(claim).toHaveBeenCalledWith(expect.objectContaining({ leaseTtlMs: 5_000 }))
    })

    it('falls back to the central policy leaseTtlMs when the endpoint omits it', async () => {
      const storage = createMemoryIdempotencyStorage()
      const claim = vi.spyOn(storage, 'claim')
      const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({
        scope: () => 'public',
        authorization: 'middleware',
        required: true,
      })
      const handler = defineEndpointHandler(endpoint, () => ({ id: 1 }))
      attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })
      handler.__set_endpoint_runtime__({
        idempotency: {
          storage: () => storage,
          scope: () => 'public',
          authorization: 'middleware',
          leaseTtlMs: 12_345,
        },
      })

      await handler(
        createEvent({ body: { amount: 100 }, headers: { 'idempotency-key': 'request-1' } }),
      )
      expect(claim).toHaveBeenCalledWith(expect.objectContaining({ leaseTtlMs: 12_345 }))
    })

    it('throws a defensive runtime error when nothing resolves storage/scope/authorization', async () => {
      const endpoint = defineEndpoint({ body: jsonRecord }).idempotency({ scope: () => 'public' })
      const handler = defineEndpointHandler(endpoint, () => ({ id: 1 }))
      attachRoute(handler, { method: 'post', routeTemplate: '/api/items' })

      // h3 v2's error wire shape uses `status`/`statusText`, not v1's
      // `statusCode`/`statusMessage`.
      await expect(
        handler(
          createEvent({ body: { amount: 100 }, headers: { 'idempotency-key': 'request-1' } }),
        ),
      ).rejects.toMatchObject({
        status: 500,
        statusText: 'Idempotency Runtime Options Error',
      })
    })
  })
})

function attachRoute(
  handler: EndpointEventHandler<any, any>,
  identity: { method: string; routeTemplate: string },
) {
  ;(
    handler as EndpointEventHandler<any, any> & {
      __set_endpoint_route__: (identity: { method: string; routeTemplate: string }) => void
    }
  ).__set_endpoint_route__(identity)
}

function createEvent(input: {
  body?: unknown
  headers?: Record<string, string>
  query?: Record<string, unknown>
  tenant?: string
}): H3Event {
  return {
    req: new Request('http://localhost/test', { headers: input.headers ?? {} }),
    res: { status: 200, statusText: undefined, headers: new Headers() },
    context: {
      body: input.body,
      query: input.query,
      tenant: input.tenant,
    },
  } as unknown as H3Event
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
