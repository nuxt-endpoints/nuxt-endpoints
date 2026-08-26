import { z } from 'zod'

const UserInput = z.object({
  name: z.string().min(1),
  age: z.number().int().nonnegative().optional(),
})

const User = z.object({
  id: z.number(),
  name: z.string(),
  age: z.number().optional(),
})

export default defineEndpoint({
  operation: 'createUser',
  body: UserInput,
  responses: {
    201: User,
  },
  handler: ({ body, respond }) => {
    return respond(201, {
      id: 101,
      name: body.name,
      age: body.age,
    })
  },
})
