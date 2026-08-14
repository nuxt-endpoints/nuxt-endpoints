import { z } from 'zod'

export const endpoint = defineEndpoint({
  operation: 'health',
  response: z.object({
    ok: z.literal(true),
    service: z.string(),
  }),
})

export default defineEndpointHandler(endpoint, () => {
  return {
    ok: true,
    service: 'nuxt-endpoints playground',
  }
})
