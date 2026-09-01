import { z } from 'zod'
import { defineRouteHandler } from '../../../../../../src/runtime'

const User = z.object({
  id: z.number(),
  name: z.string(),
})

const ErrorResponse = z.object({
  message: z.string(),
})

export default defineRouteHandler({
  params: z.object({
    id: z.string(),
  }),
  validate: {
    response: {
      200: User,
      404: ErrorResponse,
    },
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
