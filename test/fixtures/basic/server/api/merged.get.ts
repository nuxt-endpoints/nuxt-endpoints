import { z } from 'zod'
import { defineRouteHandler } from '../../../../../src/runtime'

export default defineRouteHandler({
  operation: 'getMerged',
  validate: {
    query: z.object({ id: z.coerce.number<string>() }),
    response: {
      200: z.object({ id: z.number(), name: z.string() }),
      404: z.object({ message: z.string() }),
    },
  },
  handler: ({ query, respond }) => {
    if (query.id === 0) {
      return respond(404, { message: 'Not found' })
    }
    return { id: query.id, name: 'Merged' }
  },
})
