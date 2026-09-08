import { z } from 'zod'
export default defineEndpoint({
  responses: {
    200: z.object({
      ok: z.literal(true),
      service: z.string(),
    }),
  },
  handler: () => ({
    ok: true,
    service: 'nuxt-endpoints playground',
  }),
})
