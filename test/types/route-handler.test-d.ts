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
  it('infers every handler from its own contract', () => {
    const handler = defineRouteHandler({
      params: schema<{ id: string }, { id: number }>(),
      get: {
        validate: {
          query: schema<{ search: string }, { search: string; limit: number }>(),
          response: { 200: schema<{ id: number; name: string }>() },
        },
        handler: ({ params, query, body }) => {
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
        handler: ({ params, body, respond }) => {
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
})
