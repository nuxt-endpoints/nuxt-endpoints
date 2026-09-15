import { describe, expectTypeOf, it } from 'vitest'
import type { InferRouteHandlerContract } from 'h3'
import { defineEndpoint } from '../../src/runtime'
import type { EndpointIdempotencyInput, StandardSchemaLike } from '../../src/runtime'
type Schema<INPUT, OUTPUT = INPUT> = StandardSchemaLike<INPUT, OUTPUT>
const schema = <INPUT, OUTPUT = INPUT>(): Schema<INPUT, OUTPUT> => {
  throw new Error('type-only schema')
}
describe('defineEndpoint multi-method inference', () => {
  it('constructs one cursor-pagination contract for the handler', () => {
    const Article = schema<{
      id: number
      title: string
    }>()
    const handler = defineEndpoint({
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
    const Article = schema<{
      id: number
    }>()
    const duplicateQuery = {
      pagination: { kind: 'cursor' as const, item: Article },
      request: {
        query: schema<{
          cursor?: string
        }>(),
      },
      handler: () => ({ items: [{ id: 1 }] }),
    }
    // @ts-expect-error pagination is the sole owner of query.cursor
    defineEndpoint(duplicateQuery)
    const duplicateResponse = {
      pagination: { kind: 'cursor' as const, item: Article },
      responses: {
        200: schema<{
          items: {
            id: number
          }[]
        }>(),
      },
      handler: () => ({ items: [{ id: 1 }] }),
    }
    // @ts-expect-error pagination is the sole owner of response status 200
    defineEndpoint(duplicateResponse)
    defineEndpoint({
      pagination: { kind: 'cursor', item: Article },
      // @ts-expect-error the generated successful response requires items
      handler: (event) => event.respond(200, { nextCursor: 'next' }),
    })
    defineEndpoint({
      // @ts-expect-error a direct successful return must use the generated envelope too
      pagination: { kind: 'cursor', item: Article },
      // @ts-expect-error overload resolution also rejects the incompatible handler
      handler: () => ({ nextCursor: 'next' }),
    })
  })
  it('combines non-pagination query fields and response statuses', () => {
    defineEndpoint({
      pagination: {
        kind: 'cursor',
        item: schema<{
          id: number
        }>(),
      },
      request: {
        query: schema<{
          category?: string
        }>(),
      },
      responses: {
        404: schema<{
          message: string
        }>(),
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
    defineEndpoint({
      get: {
        pagination: {
          kind: 'cursor',
          item: schema<{
            id: number
          }>(),
        },
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
        pagination: {
          kind: 'cursor' as const,
          item: schema<{
            id: number
          }>(),
        },
        handler: () => ({ items: [{ id: 1 }] }),
      },
    }
    // @ts-expect-error cursor pagination only belongs to GET
    defineEndpoint(invalidMethod)
    const duplicate = {
      get: {
        pagination: {
          kind: 'cursor' as const,
          item: schema<{
            id: number
          }>(),
        },
        request: {
          query: schema<{
            limit?: number
          }>(),
        },
        handler: () => ({ items: [{ id: 1 }] }),
      },
    }
    // @ts-expect-error pagination owns the GET member's query.limit
    defineEndpoint(duplicate)
  })
  it('requires method-group names to identify one method', () => {
    const invalidGroupName = {
      name: 'users',
      get: { handler: () => ({ ok: true }) },
      post: { handler: () => ({ ok: true }) },
    }
    // @ts-expect-error a group-level name cannot identify one HTTP method
    defineEndpoint(invalidGroupName)
    defineEndpoint({
      get: { name: 'getUsers', handler: () => ({ ok: true }) },
      post: { name: 'createUser', handler: () => ({ ok: true }) },
    })
  })
  it('types a direct handler as a validated H3 event', () => {
    defineEndpoint({
      request: {
        params: schema<
          {
            id: string
          },
          {
            id: number
          }
        >(),
      },
      handler: (event) => {
        expectTypeOf(event.validated.params).toEqualTypeOf<{
          id: number
        }>()
        expectTypeOf(event.routeDef.params).toEqualTypeOf<
          Schema<
            {
              id: string
            },
            {
              id: number
            }
          >
        >()
        expectTypeOf(event.respond).not.toBeAny()
        return { id: event.validated.params.id }
      },
    })
  })
  it('infers every handler from its own contract', () => {
    const handler = defineEndpoint({
      request: {
        params: schema<
          {
            id: string
          },
          {
            id: number
          }
        >(),
      },
      get: {
        request: {
          query: schema<
            {
              search: string
            },
            {
              search: string
              limit: number
            }
          >(),
        },
        responses: {
          200: schema<{
            id: number
            name: string
          }>(),
        },
        handler: (event) => {
          const { params, query, body } = event.validated
          expectTypeOf(params).not.toBeAny()
          expectTypeOf(query).not.toBeAny()
          expectTypeOf(body).not.toBeAny()
          expectTypeOf(params).toEqualTypeOf<{
            id: number
          }>()
          expectTypeOf(query).toEqualTypeOf<{
            search: string
            limit: number
          }>()
          expectTypeOf(body).toEqualTypeOf<undefined>()
          return { id: params.id, name: query.search }
        },
      },
      put: {
        request: {
          body: schema<{
            name: string
          }>(),
        },
        responses: {
          200: schema<{
            id: number
            name: string
          }>(),
          404: schema<{
            message: string
          }>(),
        },
        handler: (event) => {
          const { params, body } = event.validated
          const { respond } = event
          expectTypeOf(params).not.toBeAny()
          expectTypeOf(body).not.toBeAny()
          expectTypeOf(respond).not.toBeAny()
          expectTypeOf(params).toEqualTypeOf<{
            id: number
          }>()
          expectTypeOf(body).toEqualTypeOf<{
            name: string
          }>()
          return respond(200, { id: params.id, name: body.name })
        },
      },
      head: {
        responses: { 202: schema<undefined>() },
        handler: (event) => event.respond(202, undefined),
      },
      trace: {
        responses: {
          200: schema<{
            trace: string
          }>(),
        },
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
    defineEndpoint({
      get: {
        responses: {
          200: schema<{
            id: number
          }>(),
          404: schema<{
            message: string
          }>(),
        },
        // @ts-expect-error this body matches neither declared response.
        handler: () => ({ wrong: true }),
      },
    })
  })
  it('rejects a root validate in the method group form', () => {
    defineEndpoint({
      request: {
        params: schema<{
          id: number
        }>(),
        // @ts-expect-error shared request metadata only accepts route params.
        headers: schema<{
          authorization: string
        }>(),
      },
      get: { handler: (event) => ({ id: event.validated.params.id }) },
    })
  })
  it('rejects runtime-only idempotency options in the route contract', () => {
    const metadata = { enabled: true, headerName: 'Idempotency-Key', required: true } as const
    const withStorage = { ...metadata, storage: () => ({}) }
    const withScope = { ...metadata, scope: () => 'public' }
    const withAuthorization = { ...metadata, authorization: 'middleware' as const }
    const withRuntimeMethod = { idempotency: withStorage, handler: () => ({ ok: true }) }
    defineEndpoint({ idempotency: metadata, handler: () => ({ ok: true }) })
    defineEndpoint({ post: { idempotency: metadata, handler: () => ({ ok: true }) } })
    // @ts-expect-error storage belongs to the runtime implementation, not the route contract.
    defineEndpoint({ idempotency: withStorage, handler: () => ({ ok: true }) })
    // @ts-expect-error scope belongs to the runtime implementation, not the route contract.
    defineEndpoint({ idempotency: withScope, handler: () => ({ ok: true }) })
    // @ts-expect-error authorization belongs to the runtime implementation, not the route contract.
    defineEndpoint({ idempotency: withAuthorization, handler: () => ({ ok: true }) })
    defineEndpoint({
      // @ts-expect-error method entries are route contracts too.
      post: withRuntimeMethod,
    })
    const withFingerprint = { ...metadata, fingerprint: () => 'key' }
    const withReplayStatuses = { ...metadata, replayStatuses: [201] }
    const withLeaseTtl = { ...metadata, leaseTtlMs: 1000 }
    const withReplayTtl = { ...metadata, replayTtlMs: 1000 }
    // @ts-expect-error fingerprint is resolved by the runtime, not declared in the contract.
    defineEndpoint({ idempotency: withFingerprint, handler: () => ({ ok: true }) })
    // @ts-expect-error replayStatuses is resolved by the runtime, not declared in the contract.
    defineEndpoint({ idempotency: withReplayStatuses, handler: () => ({ ok: true }) })
    // @ts-expect-error leaseTtlMs is resolved by the runtime, not declared in the contract.
    defineEndpoint({ idempotency: withLeaseTtl, handler: () => ({ ok: true }) })
    // @ts-expect-error replayTtlMs is resolved by the runtime, not declared in the contract.
    defineEndpoint({ idempotency: withReplayTtl, handler: () => ({ ok: true }) })
  })
  it('accepts the authoring shorthand and normalizes it in the inferred contract', () => {
    const direct = defineEndpoint({
      request: {
        body: schema<{
          text: string
        }>(),
      },
      idempotency: true,
      handler: () => ({ ok: true }),
    })
    const grouped = defineEndpoint({
      post: {
        request: {
          body: schema<{
            text: string
          }>(),
        },
        idempotency: true,
        handler: () => ({ ok: true }),
      },
    })
    type DirectContract = InferRouteHandlerContract<typeof direct>
    type GroupedContract = InferRouteHandlerContract<typeof grouped, 'post'>
    expectTypeOf<DirectContract['idempotency']>().toEqualTypeOf<{
      enabled: true
      headerName: 'Idempotency-Key'
      required: true
    }>()
    expectTypeOf<GroupedContract['idempotency']>().toEqualTypeOf<DirectContract['idempotency']>()
    defineEndpoint({
      request: {
        body: schema<{
          text: string
        }>(),
      },
      idempotency: {},
      handler: () => ({ ok: true }),
    })
    defineEndpoint({
      request: {
        body: schema<{
          text: string
        }>(),
      },
      idempotency: { required: false },
      handler: () => ({ ok: true }),
    })
    const custom = defineEndpoint({
      request: {
        body: schema<{
          text: string
        }>(),
      },
      idempotency: { headerName: 'X-Request-Key' },
      handler: () => ({ ok: true }),
    })
    type CustomContract = InferRouteHandlerContract<typeof custom>
    expectTypeOf<CustomContract['idempotency']>().toMatchTypeOf<{
      enabled: true
      headerName: 'X-Request-Key'
      required: true
    }>()
    // @ts-expect-error idempotency is enabled by presence; omit it to disable it.
    defineEndpoint({ idempotency: false, handler: () => ({ ok: true }) })
    // @ts-expect-error enabled: false is not an authoring option.
    defineEndpoint({ idempotency: { enabled: false }, handler: () => ({ ok: true }) })
  })
  it('keeps widened authoring options sound after normalization', () => {
    const options: Exclude<EndpointIdempotencyInput, true> = {
      headerName: 'X-Request-Key',
      required: false,
    }
    const handler = defineEndpoint({
      request: {
        body: schema<{
          text: string
        }>(),
      },
      idempotency: options,
      handler: () => ({ ok: true }),
    })
    type Contract = InferRouteHandlerContract<typeof handler>
    expectTypeOf<Contract['idempotency']>().toEqualTypeOf<{
      enabled: true
      headerName: string
      required: boolean
    }>()
  })
  it('preserves authored idempotency metadata through the H3 contract projection', () => {
    const handler = defineEndpoint({
      idempotency: { enabled: true, headerName: 'Idempotency-Key', required: true },
      handler: () => ({ ok: true }),
    })
    type Contract = InferRouteHandlerContract<typeof handler>
    expectTypeOf<Contract['idempotency']>().toMatchTypeOf<{
      enabled: true
      headerName: 'Idempotency-Key'
      required: true
    }>()
  })
  it('accepts exactly one definition argument', () => {
    // @ts-expect-error runtime policy belongs in defineEndpointRuntime.
    defineEndpoint({ handler: () => ({ ok: true }) }, {})
  })

  it('rejects the removed authoring shape', () => {
    const legacyParams = {
      params: schema<{ id: string }>(),
      handler: () => ({ ok: true }),
    }
    // @ts-expect-error params moved under request.
    defineEndpoint(legacyParams)
    const legacyValidate = {
      validate: { query: schema<{ q: string }>() },
      handler: () => ({ ok: true }),
    }
    // @ts-expect-error validate was replaced by request and responses.
    defineEndpoint(legacyValidate)
    const legacyResponse = {
      response: { 200: schema<{ ok: true }>() },
      handler: () => ({ ok: true }),
    }
    // @ts-expect-error response was replaced by responses.
    defineEndpoint(legacyResponse)
  })
})
