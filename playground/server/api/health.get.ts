import { z } from 'zod'

export default defineEndpoint({
  operation: 'health',
  responses: {
    200: z.object({
      ok: z.literal(true),
      service: z.string(),
    }),
  },
  handler: () => {
    return {
      ok: true,
      service: 'nuxt-endpoints playground',
    }
  },
})
