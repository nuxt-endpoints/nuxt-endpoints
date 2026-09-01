import { describe, expectTypeOf, it } from 'vitest'
import { Schema } from 'effect'
import { defineEndpoint, defineEndpointHandler } from '../internal-runtime'
import type { InferInput, InferOutput } from '../internal-runtime'

const Params = Schema.Struct({
  id: Schema.NumberFromString,
})

const UserResponse = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
})

describe('Effect Schema support', () => {
  it('infers input and output types from real Effect schemas', () => {
    expectTypeOf<InferInput<typeof Params>>().toEqualTypeOf<Schema.Schema.Encoded<typeof Params>>()
    expectTypeOf<InferOutput<typeof Params>>().toEqualTypeOf<Schema.Schema.Type<typeof Params>>()
  })

  it('types handler context from Effect Schema outputs', () => {
    const endpoint = defineEndpoint({
      params: Params,
      responses: { 200: UserResponse },
    })

    defineEndpointHandler(endpoint, ({ params }) => {
      expectTypeOf(params).toEqualTypeOf<Schema.Schema.Type<typeof Params>>()

      return { id: params.id, name: 'Ada' }
    })
  })

  it('rejects invalid Effect Schema response returns', () => {
    const endpoint = defineEndpoint({
      responses: { 200: UserResponse },
    })

    // @ts-expect-error id must be a number.
    defineEndpointHandler(endpoint, () => {
      return { id: 'wrong', name: 'Ada' }
    })
  })
})
