import { z } from 'zod'

export default defineEndpoint({
  responses: {
    200: z.object({ available: z.boolean() }),
    404: z.object({ reason: z.literal('not_found') }),
    500: z.object({ incidentId: z.string() }),
  },
  handler: () => ({ available: true }),
})
