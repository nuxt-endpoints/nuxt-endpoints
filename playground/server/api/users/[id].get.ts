import { z } from 'zod'
import { defineRouteHandler } from '../../../../src/runtime'

const User = z.object({
  id: z.number(),
  name: z.string(),
  age: z.number().optional(),
  clientVersion: z.string(),
})

const ErrorResponse = z.object({
  message: z.string(),
})

const users = {
  '1': { id: 1, name: 'Tom', age: 21 },
  '2': { id: 2, name: 'Jane', age: 22 },
} as const

export default defineRouteHandler({
  params: z.object({
    id: z.string(),
  }),
  validate: {
    query: z.object({
      includeAge: z.coerce.boolean().optional(),
    }),
    headers: z.object({
      'x-client-version': z.string().min(1),
    }),
    response: {
      200: User,
      404: ErrorResponse,
    },
  },
  handler: (event) => {
    const user = users[event.validated.params.id as keyof typeof users]

    if (!user) return event.respond(404, { message: 'User not found' })
    return {
      id: user.id,
      name: user.name,
      age: event.validated.query.includeAge ? user.age : undefined,
      clientVersion: event.validated.headers['x-client-version'],
    }
  },
})
