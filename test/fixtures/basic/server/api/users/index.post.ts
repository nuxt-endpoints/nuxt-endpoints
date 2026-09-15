import { z } from 'zod'
import { defineEndpoint } from '../../../../../../src/runtime'
const UserInput = z.object({
  name: z.string(),
})
const User = z.object({
  id: z.number(),
  name: z.string(),
})
export default defineEndpoint({
  request: {
    body: UserInput,
  },
  responses: {
    201: User,
  },
  handler: (event) => {
    return event.respond(201, {
      id: 1,
      name: event.validated.body.name,
    })
  },
})
