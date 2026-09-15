import { z } from 'zod'
import { defineEndpoint } from '../../../../../src/runtime'
export default defineEndpoint({
  request: {
    query: z.object({ id: z.coerce.number<string>() }),
  },
  responses: {
    200: z.object({ id: z.number(), name: z.string() }),
    404: z.object({ message: z.string() }),
  },
  handler: (event) => {
    if (event.validated.query.id === 0) {
      return event.respond(404, { message: 'Not found' })
    }
    return { id: event.validated.query.id, name: 'Merged' }
  },
})
