import { z } from 'zod'
import { defineRouteHandler } from '../../../src/runtime'

export default defineRouteHandler({
  validate: {
    response: {
      200: z.object({
        ok: z.literal(true),
        service: z.string(),
      }),
    },
  },
  handler: () => ({
    ok: true,
    service: 'nuxt-endpoints playground',
  }),
})
