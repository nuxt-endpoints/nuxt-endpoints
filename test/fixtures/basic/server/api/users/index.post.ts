import { z } from 'zod'
import { defineEndpoint, defineEndpointHandler } from '../../../../../../src/runtime'

const UserInput = z.object({
  name: z.string(),
})

const User = z.object({
  id: z.number(),
  name: z.string(),
})

export const endpoint = defineEndpoint({
  operation: 'createUser',
  body: UserInput,
  responses: {
    201: User,
  },
})

export default defineEndpointHandler(endpoint, ({ body, respond }) => {
  return respond(201, {
    id: 1,
    name: body.name,
  })
})
