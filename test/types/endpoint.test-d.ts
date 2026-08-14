import { assertType, describe, expectTypeOf, it } from 'vitest'
import { defineEndpoint, defineEndpointHandler, respond } from '../../src/runtime'
import type { EndpointIdempotencyMetadata, StandardSchemaLike } from '../../src/runtime'
import type { H3Event } from 'h3'

type Schema<INPUT, OUTPUT = INPUT> = StandardSchemaLike<INPUT, OUTPUT>

const schema = <INPUT, OUTPUT = INPUT>(): Schema<INPUT, OUTPUT> => {
  throw new Error('type-only schema')
}

describe('defineEndpoint handler types', () => {
  it('preserves idempotency metadata literals and validated callback context', () => {
    const storage = {} as import('../../src/runtime').IdempotencyStorage
    const base = defineEndpoint({
      body: schema<{ amount: string }, { amount: number }>(),
    })
    const optional = base.idempotency({
      storage: ({ body }) => {
        expectTypeOf(body).toEqualTypeOf<{ amount: number }>()
        return storage
      },
      scope: ({ event }) => String(event.context.tenant),
      authorization: 'middleware',
    })
    const required = base.idempotency({
      storage: () => storage,
      scope: () => 'public',
      authorization: async ({ body }) => {
        expectTypeOf(body).toEqualTypeOf<{ amount: number }>()
      },
      headerName: 'X-Request-Key',
      required: true,
    })

    expectTypeOf(optional.definition.idempotency).toEqualTypeOf<
      EndpointIdempotencyMetadata<'Idempotency-Key', false>
    >()
    expectTypeOf(required.definition.idempotency).toEqualTypeOf<
      EndpointIdempotencyMetadata<'X-Request-Key', true>
    >()
    expectTypeOf(base.definition).not.toHaveProperty('idempotency')
  })

  it('requires an explicit authorization policy for idempotent endpoints', () => {
    const endpoint = defineEndpoint({ body: schema<{ amount: number }>() })

    // @ts-expect-error authorization must explicitly be middleware or a callback.
    endpoint.idempotency({
      storage: () => ({}) as import('../../src/runtime').IdempotencyStorage,
      scope: () => 'public',
    })
  })

  it('rejects hand-written idempotency metadata without runtime policy', () => {
    defineEndpoint({
      // @ts-expect-error idempotency metadata is created only by .idempotency().
      idempotency: {
        enabled: true,
        headerName: 'Idempotency-Key',
        required: true,
      },
    })

    const broadlyTyped: import('../../src/runtime').EndpointDefinition = {
      operation: 'broad-definition',
    }
    defineEndpoint(broadlyTyped)
  })

  it('does not require operation names for endpoint contracts', () => {
    const endpoint = defineEndpoint({
      params: schema<{ id: string }, { id: number }>(),
      response: schema<{ id: number; name: string }>(),
    })

    defineEndpointHandler(endpoint, ({ params }) => {
      expectTypeOf(params).toEqualTypeOf<{ id: number }>()

      return { id: params.id, name: 'Tom' }
    })
  })

  it('types request context from validator outputs', () => {
    const endpoint = defineEndpoint({
      operation: 'getUser',
      params: schema<{ id: string }, { id: number }>(),
      query: schema<{ include?: string }>(),
      response: schema<{ id: number; name: string }>(),
    })

    defineEndpointHandler(endpoint, ({ params, query }) => {
      expectTypeOf(params).toEqualTypeOf<{ id: number }>()
      expectTypeOf(query).toEqualTypeOf<{ include?: string }>()

      return { id: params.id, name: query.include || 'Tom' }
    })
  })

  it('exposes the H3 event and normalized web request in the handler context', () => {
    const endpoint = defineEndpoint({
      operation: 'getCurrentUser',
      response: schema<{ id: number }>(),
    })

    defineEndpointHandler(endpoint, ({ event, request }) => {
      expectTypeOf(event).toEqualTypeOf<H3Event>()
      expectTypeOf(request).toEqualTypeOf<Request>()

      return { id: event.context.userId as number }
    })
  })

  it('accepts plain returns as the 200 response', () => {
    const endpoint = defineEndpoint({
      operation: 'getUser',
      response: schema<{ id: number; name: string }>(),
    })

    defineEndpointHandler(endpoint, () => {
      return { id: 1, name: 'Tom' }
    })
  })

  it('rejects plain returns that do not match the 200 response', () => {
    const endpoint = defineEndpoint({
      operation: 'getUser',
      response: schema<{ id: number; name: string }>(),
    })

    // @ts-expect-error id must be a number.
    defineEndpointHandler(endpoint, () => {
      return { id: 'wrong', name: 'Tom' }
    })
  })

  it('accepts declared non-200 responses', () => {
    const endpoint = defineEndpoint({
      operation: 'getUser',
      responses: {
        200: schema<{ id: number; name: string }>(),
        404: schema<{ message: string }>(),
      },
    })

    defineEndpointHandler(endpoint, ({ respond }) => {
      return respond(404, { message: 'Not found' })
    })
  })

  it('preserves the success return type for Nitro InternalApi generation', () => {
    const endpoint = defineEndpoint({
      operation: 'getUser',
      responses: {
        200: schema<{ id: number; name: string }>(),
        404: schema<{ message: string }>(),
      },
    })

    const handler = defineEndpointHandler(endpoint, ({ respond }) => {
      return respond(404, { message: 'Not found' })
    })

    expectTypeOf<Awaited<ReturnType<typeof handler>>>().toEqualTypeOf<{
      id: number
      name: string
    }>()
  })

  it('rejects undeclared response statuses', () => {
    const endpoint = defineEndpoint({
      operation: 'getUser',
      responses: {
        200: schema<{ id: number; name: string }>(),
        404: schema<{ message: string }>(),
      },
    })

    // @ts-expect-error 401 is not declared.
    defineEndpointHandler(endpoint, () => {
      return respond(401, { message: 'Unauthorized' })
    })
  })

  it('rejects non-200 response bodies that do not match the declared response', () => {
    const endpoint = defineEndpoint({
      operation: 'getUser',
      responses: {
        200: schema<{ id: number; name: string }>(),
        404: schema<{ message: string }>(),
      },
    })

    defineEndpointHandler(endpoint, ({ respond }) => {
      // @ts-expect-error message is required for 404.
      return respond(404, { error: 'Not found' })
    })
  })

  it('does not require handlers to exhaust every declared response', () => {
    const endpoint = defineEndpoint({
      operation: 'getUser',
      responses: {
        200: schema<{ id: number; name: string }>(),
        400: schema<{ message: string }>(),
        404: schema<{ message: string }>(),
      },
    })

    defineEndpointHandler(endpoint, () => {
      return { id: 1, name: 'Tom' }
    })
  })

  it('exports a standalone response helper for branch helpers', () => {
    const notFound = () => respond(404, { message: 'Not found' })
    assertType<ReturnType<typeof notFound>>(respond(404, { message: 'Not found' }))
  })

  it('allows handler-inferred responses when no response contract is declared', () => {
    const endpoint = defineEndpoint({
      operation: 'getUser',
      params: schema<{ id: string }, { id: number }>(),
    })

    defineEndpointHandler(endpoint, ({ params }) => {
      return { id: params.id, name: 'Tom' }
    })
  })

  it('allows inferred status responses when no response contract is declared', () => {
    const endpoint = defineEndpoint({
      operation: 'getUser',
      params: schema<{ id: string }, { id: number }>(),
    })

    const handler = defineEndpointHandler(endpoint, ({ params, respond }) => {
      if (params.id <= 0) {
        return respond(400, { message: 'Invalid user id' })
      }

      return { id: params.id, name: 'Tom' }
    })

    expectTypeOf<Awaited<ReturnType<typeof handler>>>().toEqualTypeOf<{
      id: number
      name: string
    }>()
  })
})
