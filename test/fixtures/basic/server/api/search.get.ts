import { z } from 'zod'
import { defineEndpoint } from '../../../../../src/runtime'
export default defineEndpoint({
  request: {
    query: z.object({
      q: z.string(),
    }),
  },
  responses: {
    200: z.object({
      items: z.array(z.string()),
    }),
  },
  handler: (event) => ({ items: [event.validated.query.q] }),
})
