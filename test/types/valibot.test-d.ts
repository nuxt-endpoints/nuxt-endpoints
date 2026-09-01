import { describe, expectTypeOf, it } from 'vitest'
import * as v from 'valibot'
import { defineEndpoint, defineEndpointHandler } from '../internal-runtime'
import type { InferInput, InferOutput } from '../internal-runtime'

const Params = v.object({
  id: v.pipe(v.string(), v.transform(Number)),
})

const Query = v.object({
  include: v.optional(v.string()),
})

const UserResponse = v.object({
  id: v.number(),
  name: v.string(),
})

describe('Valibot support', () => {
  it('infers input and output types from real Valibot schemas', () => {
    expectTypeOf<InferInput<typeof Params>>().toEqualTypeOf<v.InferInput<typeof Params>>()
    expectTypeOf<InferOutput<typeof Params>>().toEqualTypeOf<v.InferOutput<typeof Params>>()
  })

  it('types handler context from Valibot outputs', () => {
    const endpoint = defineEndpoint({
      params: Params,
      query: Query,
      responses: { 200: UserResponse },
    })

    defineEndpointHandler(endpoint, ({ params, query }) => {
      expectTypeOf(params).toEqualTypeOf<v.InferOutput<typeof Params>>()
      expectTypeOf(query).toEqualTypeOf<v.InferOutput<typeof Query>>()

      return { id: params.id, name: query.include || 'Tom' }
    })
  })

  it('rejects invalid Valibot response returns', () => {
    const endpoint = defineEndpoint({
      responses: { 200: UserResponse },
    })

    // @ts-expect-error id must be a number.
    defineEndpointHandler(endpoint, () => {
      return { id: 'wrong', name: 'Tom' }
    })
  })
})
