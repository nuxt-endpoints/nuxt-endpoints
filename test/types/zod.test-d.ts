import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { defineEndpoint, defineEndpointHandler } from '../../src/runtime'
import type { EndpointClient } from '../../src/runtime'

type Client = EndpointClient<{
  path: '/api/users/:id'
  method: 'get'
  operation: 'getUser'
  definition: {
    operation: 'getUser'
    params: z.ZodObject<{ id: z.ZodString }>
    response: z.ZodObject<{ id: z.ZodNumber; name: z.ZodString }>
  }
}>

declare const client: Client

describe('Zod support', () => {
  it('accepts Zod response returns without operation names', () => {
    const endpoint = defineEndpoint({
      query: z.object({ q: z.string() }),
      response: z.object({
        items: z.array(z.string()),
      }),
    })

    defineEndpointHandler(endpoint, ({ query }) => {
      return { items: [query.q] }
    })
  })

  it('infers handler context from Zod outputs', () => {
    const endpoint = defineEndpoint({
      operation: 'getUser',
      params: z.object({ id: z.coerce.number() }),
      query: z.object({ include: z.string().optional() }),
      response: z.object({
        id: z.number(),
        name: z.string(),
      }),
    })

    defineEndpointHandler(endpoint, ({ params, query }) => {
      expectTypeOf(params).toEqualTypeOf<{ id: number }>()
      expectTypeOf(query).toEqualTypeOf<{ include?: string | undefined }>()

      return { id: params.id, name: query.include || 'Tom' }
    })
  })

  it('rejects invalid Zod response returns', () => {
    const endpoint = defineEndpoint({
      operation: 'getUser',
      response: z.object({
        id: z.number(),
        name: z.string(),
      }),
    })

    // @ts-expect-error id must be a number.
    defineEndpointHandler(endpoint, () => {
      return { id: 'wrong', name: 'Tom' }
    })
  })

  it('types client options and responses from Zod contracts', () => {
    const user = client('getUser', { params: { id: '1' } })

    // @ts-expect-error params.id must match the Zod input.
    client('getUser', { params: { id: 1 } })

    expectTypeOf<Awaited<typeof user>>().toEqualTypeOf<{
      id: number
      name: string
    }>()
  })
})
