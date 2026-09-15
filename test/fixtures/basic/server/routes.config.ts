import { z } from 'zod'
import { defineServerRouteConfig } from '../../../../src/runtime'

export default defineServerRouteConfig({
  routes: {
    '/normalized/について': {
      responses: { 418: z.object({ message: z.literal('authored-scope') }) },
    },
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
