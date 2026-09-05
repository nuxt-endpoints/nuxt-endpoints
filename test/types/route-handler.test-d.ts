import { describe, expectTypeOf, it } from 'vitest'
import type { InferRouteHandlerContract } from 'h3'
import { defineRouteHandler } from '../../src/runtime'
import type { StandardSchemaLike } from '../../src/runtime'

type Schema<INPUT, OUTPUT = INPUT> = StandardSchemaLike<INPUT, OUTPUT>

const schema = <INPUT, OUTPUT = INPUT>(): Schema<INPUT, OUTPUT> => {
  throw new Error('type-only schema')
}

describe('defineRouteHandler multi-method inference', () => {
  it('constructs one cursor-pagination contract for the handler', () => {
    const Article = schema<{ id: number; title: string }>()
    const handler = defineRouteHandler({
      pagination: { kind: 'cursor', item: Article },
      handler: (event) => {
        expectTypeOf(event.validated.query).toMatchTypeOf<{
          cursor?: string
          limit: number
        }>()
        return { items: [{ id: 1, title: 'one' }], nextCursor: 'next' }
      },
    })

    expectTypeOf(handler).not.toBeAny()
  })

  it('refuses duplicate pagination query and response declarations', () => {
    const Article = schema<{ id: number }>()
    const duplicateQuery = {
      pagination: { kind: 'cursor' as const, item: Article },
      validate: { query: schema<{ cursor?: string }>() },
      handler: () => ({ items: [{ id: 1 }] }),
    }
    // @ts-expect-error pagination is the sole owner of query.cursor
    defineRouteHandler(duplicateQuery)

    const duplicateResponse = {
      pagination: { kind: 'cursor' as const, item: Article },
      validate: { response: { 200: schema<{ items: { id: number }[] }>() } },
      handler: () => ({ items: [{ id: 1 }] }),
    }
    // @ts-expect-error pagination is the sole owner of response status 200
    defineRouteHandler(duplicateResponse)

    defineRouteHandler({
      pagination: { kind: 'cursor', item: Article },
      // @ts-expect-error the generated successful response requires items
      handler: (event) => event.respond(200, { nextCursor: 'next' }),
    })

    defineRouteHandler({
      // @ts-expect-error a direct successful return must use the generated envelope too
      pagination: { kind: 'cursor', item: Article },
      // @ts-expect-error overload resolution also rejects the incompatible handler
      handler: () => ({ nextCursor: 'next' }),
    })
  })

  it('combines non-pagination query fields and response statuses', () => {
    defineRouteHandler({
      pagination: { kind: 'cursor', item: schema<{ id: number }>() },
      validate: {
        query: schema<{ category?: string }>(),
        response: { 404: schema<{ message: string }>() },
      },
      handler: (event) => {
        expectTypeOf(event.validated.query).toMatchTypeOf<{
          category?: string
          cursor?: string
          limit: number
        }>()
        return { items: [{ id: 1 }] }
      },
    })
  })

  it('supports pagination only on the GET member of a method group', () => {
    defineRouteHandler({
      get: {
        pagination: { kind: 'cursor', item: schema<{ id: number }>() },
        handler: (event) => {
          expectTypeOf(event.validated.query.limit).toEqualTypeOf<number>()
          return { items: [{ id: 1 }] }
        },
      },
      post: {
        handler: () => ({ created: true }),
      },
    })

    const invalidMethod = {
      post: {
        pagination: { kind: 'cursor' as const, item: schema<{ id: number }>() },
        handler: () => ({ items: [{ id: 1 }] }),
      },
    }
    // @ts-expect-error cursor pagination only belongs to GET
    defineRouteHandler(invalidMethod)

    const duplicate = {
      get: {
        pagination: { kind: 'cursor' as const, item: schema<{ id: number }>() },
        validate: { query: schema<{ limit?: number }>() },
        handler: () => ({ items: [{ id: 1 }] }),
      },
    }
    // @ts-expect-error pagination owns the GET member's query.limit
    defineRouteHandler(duplicate)
  })

  it('types a direct handler as a validated H3 event', () => {
    defineRouteHandler({
      params: schema<{ id: string }, { id: number }>(),
      handler: (event) => {
        expectTypeOf(event.validated.params).toEqualTypeOf<{ id: number }>()
        expectTypeOf(event.routeDef.params).toEqualTypeOf<Schema<{ id: string }, { id: number }>>()
        expectTypeOf(event.respond).not.toBeAny()
        return { id: event.validated.params.id }
      },
    })
  })

  it('infers every handler from its own contract', () => {
    const handler = defineRouteHandler({
      params: schema<{ id: string }, { id: number }>(),
      get: {
        validate: {
          query: schema<{ search: string }, { search: string; limit: number }>(),
          response: { 200: schema<{ id: number; name: string }>() },
        },
        handler: (event) => {
          const { params, query, body } = event.validated
          expectTypeOf(params).not.toBeAny()
          expectTypeOf(query).not.toBeAny()
          expectTypeOf(body).not.toBeAny()
          expectTypeOf(params).toEqualTypeOf<{ id: number }>()
          expectTypeOf(query).toEqualTypeOf<{ search: string; limit: number }>()
          expectTypeOf(body).toEqualTypeOf<undefined>()
          return { id: params.id, name: query.search }
        },
      },
      put: {
        validate: {
          body: schema<{ name: string }>(),
          response: {
            200: schema<{ id: number; name: string }>(),
            404: schema<{ message: string }>(),
          },
        },
        handler: (event) => {
          const { params, body } = event.validated
          const { respond } = event
          expectTypeOf(params).not.toBeAny()
          expectTypeOf(body).not.toBeAny()
          expectTypeOf(respond).not.toBeAny()
          expectTypeOf(params).toEqualTypeOf<{ id: number }>()
          expectTypeOf(body).toEqualTypeOf<{ name: string }>()
          return respond(200, { id: params.id, name: body.name })
        },
      },
      head: {
        validate: { response: { 202: schema<undefined>() } },
        handler: (event) => event.respond(202, undefined),
      },
      trace: {
        validate: { response: { 200: schema<{ trace: string }>() } },
        handler: () => ({ trace: 'ok' }),
      },
    })

    expectTypeOf(handler.__endpoint_method_handler_returns__.get.id).toEqualTypeOf<number>()
    expectTypeOf(handler.__endpoint_method_handler_returns__.get.name).toEqualTypeOf<string>()
    expectTypeOf(handler.__endpoint_method_handler_returns__.put.status).toEqualTypeOf<200>()
    expectTypeOf(handler.__endpoint_method_handler_returns__.put.body).toEqualTypeOf<{
      id: number
      name: string
    }>()
    expectTypeOf(handler.__endpoint_method_handler_returns__.head.status).toEqualTypeOf<202>()
    expectTypeOf(handler.__endpoint_method_handler_returns__.trace).toEqualTypeOf<{
      trace: string
    }>()
  })

  it('rejects a response outside the method contract', () => {
    defineRouteHandler({
      get: {
        validate: {
          response: {
            200: schema<{ id: number }>(),
            404: schema<{ message: string }>(),
          },
        },
        // @ts-expect-error this body matches neither declared response.
        handler: () => ({ wrong: true }),
      },
    })
  })

  it('rejects a root validate in the method group form', () => {
    defineRouteHandler({
      params: schema<{ id: number }>(),
      // @ts-expect-error request validation is per method, so a root validate never applies.
      validate: { headers: schema<{ authorization: string }>() },
      get: { handler: (event) => ({ id: event.validated.params.id }) },
    })
  })

  it('rejects runtime-only idempotency options in the route contract', () => {
    const metadata = { enabled: true, headerName: 'Idempotency-Key', required: true } as const
    const withStorage = { ...metadata, storage: () => ({}) }
    const withScope = { ...metadata, scope: () => 'public' }
    const withAuthorization = { ...metadata, authorization: 'middleware' as const }
    const withRuntimeMethod = { idempotency: withStorage, handler: () => ({ ok: true }) }

    defineRouteHandler({ idempotency: metadata, handler: () => ({ ok: true }) })
    defineRouteHandler({ post: { idempotency: metadata, handler: () => ({ ok: true }) } })

    defineRouteHandler({
      // @ts-expect-error storage belongs to the runtime implementation, not the route contract.
      idempotency: withStorage,
      handler: () => ({ ok: true }),
    })

    defineRouteHandler({
      // @ts-expect-error scope belongs to the runtime implementation, not the route contract.
      idempotency: withScope,
      handler: () => ({ ok: true }),
    })

    defineRouteHandler({
      // @ts-expect-error authorization belongs to the runtime implementation, not the route contract.
      idempotency: withAuthorization,
      handler: () => ({ ok: true }),
    })

    defineRouteHandler({
      // @ts-expect-error method entries are route contracts too.
      post: withRuntimeMethod,
    })

    const withFingerprint = { ...metadata, fingerprint: () => 'key' }
    const withReplayStatuses = { ...metadata, replayStatuses: [201] }
    const withLeaseTtl = { ...metadata, leaseTtlMs: 1000 }
    const withReplayTtl = { ...metadata, replayTtlMs: 1000 }

    defineRouteHandler({
      // @ts-expect-error fingerprint is resolved by the runtime, not declared in the contract.
      idempotency: withFingerprint,
      handler: () => ({ ok: true }),
    })

    defineRouteHandler({
      // @ts-expect-error replayStatuses is resolved by the runtime, not declared in the contract.
      idempotency: withReplayStatuses,
      handler: () => ({ ok: true }),
    })

    defineRouteHandler({
      // @ts-expect-error leaseTtlMs is resolved by the runtime, not declared in the contract.
      idempotency: withLeaseTtl,
      handler: () => ({ ok: true }),
    })

    defineRouteHandler({
      // @ts-expect-error replayTtlMs is resolved by the runtime, not declared in the contract.
      idempotency: withReplayTtl,
      handler: () => ({ ok: true }),
    })
  })

  it('preserves authored idempotency metadata through the H3 contract projection', () => {
    const handler = defineRouteHandler({
      idempotency: { enabled: true, headerName: 'Idempotency-Key', required: true },
      handler: () => ({ ok: true }),
    })

    type Contract = InferRouteHandlerContract<typeof handler>
    expectTypeOf<Contract>().toMatchTypeOf<{
      idempotency: { enabled: true; headerName: 'Idempotency-Key'; required: true }
    }>()
  })

  it('uses the same one-argument shape as H3', () => {
    // @ts-expect-error defineRouteHandler has the same one-argument shape as H3.
    defineRouteHandler({ handler: () => ({ ok: true }) }, {})
  })
})
