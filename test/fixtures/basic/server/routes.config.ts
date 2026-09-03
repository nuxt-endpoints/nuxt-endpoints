import { z } from 'zod'
import { defineServerRouteConfig } from '../../../../src/runtime'

export default defineServerRouteConfig({
  routes: {
    '/api/users/**': {
      responses: {
        401: z.object({ error: z.literal('unauthorized') }),
      },
      methods: {
        post: {
          responses: {
            429: z.object({ retryAfter: z.number() }),
          },
        },
      },
    },
  },
})
