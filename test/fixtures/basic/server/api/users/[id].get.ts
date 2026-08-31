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
  operation: 'getUser',
  params: z.object({
    id: z.string(),
  }),
  validate: {
    response: {
      200: User,
      404: ErrorResponse,
    },
  },
  handler: ({ params, respond }) => {
    if (params.id === '404') {
      return respond(404, { message: 'Not found' })
    }

    return {
      id: Number(params.id),
      name: 'Tom',
    }
  },
})
