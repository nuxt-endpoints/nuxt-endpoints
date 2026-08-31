import { z } from 'zod'
import { defineRouteHandler } from '../../../../../src/runtime'

export default defineRouteHandler({
  validate: {
    query: z.object({
      q: z.string(),
    }),
    response: {
      200: z.object({
        items: z.array(z.string()),
      }),
    },
  },
  handler: ({ query }) => ({ items: [query.q] }),
})
