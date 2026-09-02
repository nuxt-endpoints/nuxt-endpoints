import { z } from 'zod'
import { defineRouteHandler } from '../../../../src/runtime'

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
  validate: {
    body: UserInput,
    response: {
      201: User,
    },
  },
  handler: (event) =>
    event.respond(201, { id: 101, name: event.validated.body.name, age: event.validated.body.age }),
})
