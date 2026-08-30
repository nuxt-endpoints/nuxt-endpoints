import { z } from 'zod'
import { defineEndpoint } from '../../../../../src/runtime'

// PROTOTYPE: single-define (merged) form - contract and handler in one call.
export default defineEndpoint({
  operation: 'getMerged',
  query: z.object({ id: z.coerce.number<string>() }),
  responses: {
    200: z.object({ id: z.number(), name: z.string() }),
    404: z.object({ message: z.string() }),
  },
  handler: ({ query, respond }) => {
    if (query.id === 0) {
      return respond(404, { message: 'Not found' })
    }
    return { id: query.id, name: 'Merged' }
  },
})
