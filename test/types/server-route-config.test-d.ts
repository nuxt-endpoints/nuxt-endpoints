import { describe, expectTypeOf, it } from 'vitest'
import type { ResponseBody, ServerRouteResponsesFor, StandardSchemaLike } from '../../src/runtime'
import { defineServerRouteConfig } from '../../src/runtime'

type Schema<OUTPUT> = StandardSchemaLike<OUTPUT>

declare const unauthorized: Schema<{ error: 'unauthorized' }>
declare const adminUnauthorized: Schema<{ error: 'admin_unauthorized' }>
declare const unavailable: Schema<{ error: 'unavailable' }>
declare const rateLimited: Schema<{ retryAfter: number }>

const config = defineServerRouteConfig({
  responses: {
    401: unauthorized,
    503: unavailable,
  },
  routes: {
    '/api/admin/**': {
      responses: {
        401: adminUnauthorized,
      },
      methods: {
        post: {
          responses: {
            429: rateLimited,
          },
        },
      },
    },
  },
})

describe('defineServerRouteConfig response scopes', () => {
  it('combines global, matching path, and method responses', () => {
    type Responses = ServerRouteResponsesFor<typeof config, '/api/admin/users/:id', 'post'>

    expectTypeOf<keyof Responses>().toEqualTypeOf<401 | 429 | 503>()
    expectTypeOf<ResponseBody<Responses[401]>>().toEqualTypeOf<
      { error: 'unauthorized' } | { error: 'admin_unauthorized' }
    >()
    expectTypeOf<ResponseBody<Responses[429]>>().toEqualTypeOf<{ retryAfter: number }>()
  })

  it('does not apply a path or method scope outside its match', () => {
    type Responses = ServerRouteResponsesFor<typeof config, '/api/public', 'get'>

    expectTypeOf<keyof Responses>().toEqualTypeOf<401 | 503>()
  })
})
