import { assertType, describe, expectTypeOf, it } from 'vitest'
import {
  defineEndpoint,
  defineEndpointMethodHandlers,
  defineEndpointMethods,
} from '../internal-runtime'
import type { EndpointMethodMember, StandardSchemaLike } from '../internal-runtime'

type Schema<INPUT, OUTPUT = INPUT> = StandardSchemaLike<INPUT, OUTPUT>

const schema = <INPUT, OUTPUT = INPUT>(): Schema<INPUT, OUTPUT> => {
  throw new Error('type-only schema')
}

describe('defineEndpointMethods structural constraint', () => {
  it('accepts a concrete DefinedEndpoint as an EndpointMethodMember', () => {
    const endpoint = defineEndpoint({ responses: { 200: schema<{ id: number }>() } })
    assertType<EndpointMethodMember>(endpoint)
  })
})

describe('defineEndpointMethodHandlers handler context inference', () => {
  it('infers each handler context from its own member definition', () => {
    const endpoints = defineEndpointMethods({
      get: defineEndpoint({
        params: schema<{ id: string }, { id: number }>(),
        responses: { 200: schema<{ id: number; name: string }>() },
      }),
      put: defineEndpoint({
        params: schema<{ id: string }, { id: number }>(),
        body: schema<{ name: string }>(),
        responses: { 200: schema<{ id: number; name: string }>() },
      }),
    })

    defineEndpointMethodHandlers(endpoints, {
      get: ({ params, body }) => {
        expectTypeOf(params).toEqualTypeOf<{ id: number }>()
        expectTypeOf(body).toEqualTypeOf<undefined>()
        return { id: params.id, name: 'Tom' }
      },
      put: ({ params, body }) => {
        expectTypeOf(params).toEqualTypeOf<{ id: number }>()
        expectTypeOf(body).toEqualTypeOf<{ name: string }>()
        return { id: params.id, name: body.name }
      },
    })
  })

  it('rejects an undeclared response body for a member with declared responses', () => {
    const endpoints = defineEndpointMethods({
      get: defineEndpoint({
        responses: {
          200: schema<{ id: number; name: string }>(),
          404: schema<{ message: string }>(),
        },
      }),
    })

    defineEndpointMethodHandlers(endpoints, {
      // @ts-expect-error the returned shape matches neither the 200 nor the
      // 404 response contract, and this member never calls `respond`.
      get: () => ({ wrong: true }),
    })
  })

  it('accepts a declared non-200 response via respond', () => {
    const endpoints = defineEndpointMethods({
      get: defineEndpoint({
        responses: {
          200: schema<{ id: number; name: string }>(),
          404: schema<{ message: string }>(),
        },
      }),
    })

    defineEndpointMethodHandlers(endpoints, {
      get: ({ respond }) => respond(404, { message: 'Not found' }),
    })
  })

  it('requires a handler for every declared method', () => {
    const endpoints = defineEndpointMethods({
      get: defineEndpoint({ responses: { 200: schema<{ id: number }>() } }),
      put: defineEndpoint({ body: schema<{ name: string }>() }),
    })

    // @ts-expect-error `put` has no handler.
    defineEndpointMethodHandlers(endpoints, {
      get: () => ({ id: 1 }),
    })
  })

  it('types __endpoint_method_handler_returns__ as the handler return map', () => {
    const endpoints = defineEndpointMethods({
      get: defineEndpoint({ params: schema<{ id: string }, { id: number }>() }),
      put: defineEndpoint({ body: schema<{ name: string }>() }),
    })

    const handler = defineEndpointMethodHandlers(endpoints, {
      get: ({ params }) => ({ id: params.id, name: 'Tom' }),
      put: ({ body }) => ({ created: body.name }),
    })

    expectTypeOf(handler.__endpoint_method_handler_returns__).toEqualTypeOf<{
      get: { id: number; name: string }
      put: { created: string }
    }>()
  })

  it('infers explicitly declared HEAD, OPTIONS, CONNECT, and TRACE handlers', () => {
    const endpoints = defineEndpointMethods({
      head: defineEndpoint({ responses: { 202: schema<undefined>() } }),
      options: defineEndpoint({ responses: { 204: schema<undefined>() } }),
      connect: defineEndpoint({ responses: { 200: schema<{ tunnel: true }>() } }),
      trace: defineEndpoint({ responses: { 200: schema<{ trace: string }>() } }),
    })

    const handler = defineEndpointMethodHandlers(endpoints, {
      head: ({ respond }) => respond(202, undefined),
      options: ({ respond }) => respond(204, undefined),
      connect: () => ({ tunnel: true as const }),
      trace: () => ({ trace: 'ok' }),
    })

    expectTypeOf(handler.__endpoint_method_handler_returns__.head.status).toEqualTypeOf<202>()
    expectTypeOf(handler.__endpoint_method_handler_returns__.options.status).toEqualTypeOf<204>()
    expectTypeOf(handler.__endpoint_method_handler_returns__.connect).toEqualTypeOf<{
      tunnel: true
    }>()
    expectTypeOf(handler.__endpoint_method_handler_returns__.trace).toEqualTypeOf<{
      trace: string
    }>()
  })
})
