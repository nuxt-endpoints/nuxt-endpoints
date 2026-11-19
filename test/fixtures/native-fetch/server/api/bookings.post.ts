import { z } from 'zod'

export default defineEndpoint({
  validate: {
    body: z.object({ slotId: z.string() }),
    query: z.object({ view: z.enum(['compact', 'full']) }),
    headers: z.object({ 'x-api-version': z.literal('v1') }),
  },
  responses: {
    201: z.object({ bookingId: z.string() }),
    409: z.object({ reason: z.literal('slot_taken') }),
  },
  handler(event) {
    return event.respond(409, { reason: 'slot_taken' })
  },
})
