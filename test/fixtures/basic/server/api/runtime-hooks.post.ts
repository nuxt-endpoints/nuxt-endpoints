import { z } from 'zod'
import { defineRouteHandler } from '../../../../../src/runtime'

export default defineRouteHandler({
  validate: {
    query: z.object({ q: z.string() }),
    body: z.object({ name: z.string() }),
    response: {
      200: z.object({ name: z.string(), q: z.string() }),
    },
  },
  handler: (event) => ({
    name: event.validated.body.name,
    q: event.validated.query.q,
  }),
})
