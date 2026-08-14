import { z } from 'zod'
import { defineEndpoint, defineEndpointHandler } from '../../../../../../src/runtime'

const User = z.object({
  id: z.number(),
  name: z.string(),
})

const ErrorResponse = z.object({
  message: z.string(),
})

export const endpoint = defineEndpoint({
  operation: 'getUser',
  params: z.object({
    id: z.string(),
  }),
  responses: {
    200: User,
    404: ErrorResponse,
  },
})

export default defineEndpointHandler(endpoint, ({ params, respond }) => {
  if (params.id === '404') {
    return respond(404, { message: 'Not found' })
  }

  return {
    id: Number(params.id),
    name: 'Tom',
  }
})
