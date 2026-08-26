import { z } from 'zod'

const PlaygroundUser = z.object({
  id: z.number(),
  name: z.string(),
  createdAt: z.string(),
})

export default defineEndpoint({
  operation: 'createSqliteUser',
  summary: 'Persist a user in the playground SQLite database',
  body: z.object({
    name: z.string().trim().min(1).max(80),
  }),
  responses: {
    201: PlaygroundUser,
  },
  idempotency: {
    required: true,
    storage: () => getPlaygroundIdempotencyStorage(),
    scope: () => 'sqlite-playground',
    authorization: 'middleware',
  },
  handler: ({ body, respond }) => {
    return respond(201, createPlaygroundUser(body.name))
  },
})
