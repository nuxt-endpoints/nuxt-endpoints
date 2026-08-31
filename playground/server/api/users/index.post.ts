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

export default defineRouteHandler({
  operation: 'createUser',
  validate: {
    body: UserInput,
    response: {
      201: User,
    },
  },
  handler: ({ body, respond }) => respond(201, { id: 101, name: body.name, age: body.age }),
})
