import { describe, expectTypeOf, it } from 'vitest'
import { defineRouteHandler } from '../../src/runtime'
import type { StandardSchemaLike } from '../../src/runtime'

type Schema<INPUT, OUTPUT = INPUT> = StandardSchemaLike<INPUT, OUTPUT>

const schema = <INPUT, OUTPUT = INPUT>(): Schema<INPUT, OUTPUT> => {
  throw new Error('type-only schema')
}

describe('defineRouteHandler multi-method inference', () => {
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
  })

  it('uses the same one-argument shape as H3', () => {
    // @ts-expect-error defineRouteHandler has the same one-argument shape as H3.
    defineRouteHandler({ handler: () => ({ ok: true }) }, {})
  })
})
