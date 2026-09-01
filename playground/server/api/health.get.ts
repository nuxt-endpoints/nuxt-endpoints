import { z } from 'zod'

export default defineRouteHandler({
  operation: 'health',
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
