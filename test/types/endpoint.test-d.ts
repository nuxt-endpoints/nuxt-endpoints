import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
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

  it('defaults every runtime option to the central policy when .idempotency() is called without any', () => {
    const endpoint = defineEndpoint({ body: schema<{ amount: number }>() })
    const central = endpoint.idempotency()

    expectTypeOf(central.definition.idempotency).toEqualTypeOf<
      EndpointIdempotencyMetadata<'Idempotency-Key', false>
    >()
  })

  it('allows storage, scope, and authorization to be omitted individually', () => {
    const storage = {} as import('../../src/runtime').IdempotencyStorage
    const endpoint = defineEndpoint({ body: schema<{ amount: number }>() })

    // Every runtime option may come from the central policy instead, so any
    // subset (including none) of storage/scope/authorization is valid here.
    endpoint.idempotency({})
    endpoint.idempotency({ storage: () => storage })
    endpoint.idempotency({ scope: () => 'public' })
    endpoint.idempotency({ authorization: 'middleware' })
    const partial = endpoint.idempotency({ required: true })

    expectTypeOf(partial.definition.idempotency).toEqualTypeOf<
      EndpointIdempotencyMetadata<'Idempotency-Key', true>
    >()
  })

  it('still rejects an authorization value that is not middleware or a callback', () => {
    const endpoint = defineEndpoint({ body: schema<{ amount: number }>() })

    endpoint.idempotency({
      storage: () => ({}) as import('../../src/runtime').IdempotencyStorage,
      scope: () => 'public',
      // @ts-expect-error authorization must be 'middleware' or a callback.
      authorization: 'not-middleware',
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

describe('tuple and literal response contracts', () => {
  it('accepts a tuple-typed response value', () => {
    const endpoint = defineEndpoint({
      response: z.object({ pair: z.tuple([z.string(), z.number()]) }),
    })
    const pair: [string, number] = ['a', 1]

    defineEndpointHandler(endpoint, () => ({ pair }))
    // `as const` works too: the readonly tuple keeps its arity through the
    // handler return check.
    defineEndpointHandler(endpoint, () => ({ pair: ['a', 1] }) as const)
  })

  it('keeps rejecting a tuple whose positions do not match', () => {
    const endpoint = defineEndpoint({
      response: z.object({ pair: z.tuple([z.string(), z.number()]) }),
    })

    // @ts-expect-error the second position must be a number.
    defineEndpointHandler(endpoint, () => ({ pair: ['a', 'b'] }) as const)
  })

  it('accepts inline literals and tuples without as const', () => {
    const literal = defineEndpoint({ response: z.object({ ok: z.literal(true) }) })
    defineEndpointHandler(literal, () => ({ ok: true }))

    const tuple = defineEndpoint({
      response: z.object({ pair: z.tuple([z.string(), z.number()]) }),
    })
    defineEndpointHandler(tuple, () => ({ pair: ['a', 1] }))
  })

  it('still rejects inline values that do not match the contract', () => {
    const literal = defineEndpoint({ response: z.object({ ok: z.literal(true) }) })
    // @ts-expect-error false does not satisfy the declared literal.
    defineEndpointHandler(literal, () => ({ ok: false }))

    const tuple = defineEndpoint({
      response: z.object({ pair: z.tuple([z.string(), z.number()]) }),
    })
    // @ts-expect-error the second position must be a number.
    defineEndpointHandler(tuple, () => ({ pair: ['a', 'b'] }))
    // @ts-expect-error the tuple has two positions.
    defineEndpointHandler(tuple, () => ({ pair: ['a', 1, 'extra'] }))
  })

  it('keeps widening the return of a handler with no declared responses', () => {
    const endpoint = defineEndpoint({ query: z.object({ q: z.string() }) })
    const handler = defineEndpointHandler(endpoint, () => ({ name: 'Tom' }))

    // The sample value must not narrow the generated client type to 'Tom'.
    expectTypeOf<Awaited<ReturnType<typeof handler>>>().toEqualTypeOf<{ name: string }>()
  })

  it('still accepts ordinary arrays', () => {
    const endpoint = defineEndpoint({ response: z.object({ items: z.array(z.string()) }) })

    defineEndpointHandler(endpoint, () => ({ items: ['a', 'b'] }))
  })

  it('accepts every body shape the HTTP layer forwards for a stream status', () => {
    const endpoint = defineEndpoint({
      responses: {
        200: { media: 'text/csv' },
        404: z.object({ message: z.string() }),
      },
    })

    defineEndpointHandler(endpoint, ({ respond: send }) => send(200, new ReadableStream()))
    defineEndpointHandler(endpoint, ({ respond: send }) => send(200, new Response('id,name\n')))
    defineEndpointHandler(endpoint, ({ respond: send }) => send(200, 'id,name\n'))
    defineEndpointHandler(endpoint, ({ respond: send }) => send(200, new Uint8Array([1, 2])))

    // The other declared statuses keep their validated bodies.
    defineEndpointHandler(endpoint, ({ respond: send }) => send(404, { message: 'gone' }))
    // @ts-expect-error the 404 body is still checked against its schema.
    defineEndpointHandler(endpoint, ({ respond: send }) => send(404, { detail: 'gone' }))
  })

  it('narrows responseMediaType to the declared media types', () => {
    const negotiating = defineEndpoint({
      responses: {
        200: { media: ['text/csv', 'application/json'] },
        404: z.object({ message: z.string() }),
      },
    })

    defineEndpointHandler(negotiating, ({ responseMediaType, respond: send }) => {
      expectTypeOf(responseMediaType).toEqualTypeOf<'text/csv' | 'application/json'>()
      // Answered on the validated status rather than the negotiated one: the
      // body type of an array `media` status is still `never` (see the note in
      // media-response.test.ts), which is a separate gap from the narrowing
      // this test is about.
      return send(404, { message: 'gone' })
    })

    const single = defineEndpoint({
      responses: {
        200: { media: 'text/csv' },
      },
    })

    defineEndpointHandler(single, ({ responseMediaType, respond: send }) => {
      expectTypeOf(responseMediaType).toEqualTypeOf<'text/csv'>()
      return send(200, new ReadableStream())
    })

    const validated = defineEndpoint({
      responses: {
        200: z.object({ id: z.number() }),
      },
    })

    defineEndpointHandler(validated, ({ responseMediaType }) => {
      expectTypeOf(responseMediaType).toEqualTypeOf<undefined>()
      return { id: 1 }
    })
  })
})
