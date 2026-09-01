import { describe, expectTypeOf, it } from 'vitest'
import { defineRouteHandler } from '../../src/runtime'
import type {
  EndpointDefinitionFromRoute,
  EndpointHandlerReturnFromRoute,
  StandardSchemaLike,
} from '../../src/runtime'

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
    })

    type Definition = (typeof handler)['~routeDef']
    type GetReturn = Awaited<EndpointHandlerReturnFromRoute<Definition, 'get'>>
    type PutReturn = Awaited<EndpointHandlerReturnFromRoute<Definition, 'put'>>
    type PutDefinition = EndpointDefinitionFromRoute<Definition, 'put'>

    expectTypeOf<GetReturn['id']>().toEqualTypeOf<number>()
    expectTypeOf<GetReturn['name']>().toEqualTypeOf<string>()
    expectTypeOf<PutReturn['status']>().toEqualTypeOf<200>()
    expectTypeOf<PutReturn['body']>().toEqualTypeOf<{
      id: number
      name: string
    }>()
    expectTypeOf<PutDefinition['params']>().toEqualTypeOf<Schema<{ id: string }, { id: number }>>()
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
      params: schema<{ id: string }, { id: number }>(),
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

  it('uses the same one-argument shape as H3', () => {
    // @ts-expect-error defineRouteHandler has the same one-argument shape as H3.
    defineRouteHandler({ handler: () => ({ ok: true }) }, {})
  })

  it('rejects the methods this line derives or does not route', () => {
    const get = { handler: () => ({ ok: true }) }
    const derived = { handler: () => null }

    // @ts-expect-error HEAD is derived from the get entry.
    defineRouteHandler({ get, head: derived })
    // @ts-expect-error OPTIONS is answered from the declared methods.
    defineRouteHandler({ get, options: derived })
    // @ts-expect-error CONNECT is not routed on this support line.
    defineRouteHandler({ get, connect: derived })
    // @ts-expect-error TRACE is not routed on this support line.
    defineRouteHandler({ get, trace: derived })
  })
})
