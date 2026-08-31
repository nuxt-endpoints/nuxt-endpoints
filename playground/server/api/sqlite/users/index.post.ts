import { z } from 'zod'

const PlaygroundUser = z.object({
  id: z.number(),
  name: z.string(),
  createdAt: z.string(),
})

export default defineRouteHandler(
  {
    operation: 'createSqliteUser',
    summary: 'Persist a user in the playground SQLite database',
    validate: {
      body: z.object({
        name: z.string().trim().min(1).max(80),
      }),
      response: {
        201: PlaygroundUser,
      },
    },
    idempotency: {
      enabled: true,
      headerName: 'Idempotency-Key',
      required: true,
    },
    handler: ({ body, respond }) => respond(201, createPlaygroundUser(body.name)),
  },
  {
    idempotency: {
      storage: () => getPlaygroundIdempotencyStorage(),
      scope: () => 'sqlite-playground',
      authorization: 'middleware',
    },
  },
)
