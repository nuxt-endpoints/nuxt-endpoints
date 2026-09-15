import { z } from 'zod'
import { defineEndpoint } from '../../../../../src/runtime'
export default defineEndpoint({
  request: {
    query: z.object({ q: z.string() }),
    body: z.object({ name: z.string() }),
  },
  responses: {
    200: z.object({ name: z.string(), q: z.string() }),
  },
  handler: (event) => ({
    name: event.validated.body.name,
    q: event.validated.query.q,
  }),
})
