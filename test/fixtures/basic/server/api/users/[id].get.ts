import { z } from 'zod'
import { defineEndpoint } from '../../../../../../src/runtime'
const User = z.object({
  id: z.number(),
  name: z.string(),
})
const ErrorResponse = z.object({
  message: z.string(),
})
export default defineEndpoint({
  name: 'getUser',
  request: {
    params: z.object({
      id: z.string(),
    }),
  },
  responses: {
    200: User,
    404: ErrorResponse,
  },
  handler: (event) => {
    if (event.validated.params.id === '404') {
      return event.respond(404, { message: 'Not found' })
    }
    return {
      id: Number(event.validated.params.id),
      name: 'Tom',
    }
  },
})
