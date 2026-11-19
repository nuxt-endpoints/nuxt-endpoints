import { getCookie } from 'h3'
import { z } from 'zod'

export default defineEndpoint({
  validate: {
    params: z.object({ id: z.string() }),
    query: z.object({
      includePosts: z
        .union([z.boolean(), z.enum(['true', 'false'])])
        .transform((value) => value === true || value === 'true')
        .optional(),
    }),
  },
  responses: {
    200: z.object({ name: z.string() }),
    404: z.object({ reason: z.literal('user_not_found') }),
  },
  handler(event) {
    if (getCookie(event, 'session') !== 'test') {
      return event.respond(404, { reason: 'user_not_found' })
    }

    return { name: event.validated.params.id }
  },
})
