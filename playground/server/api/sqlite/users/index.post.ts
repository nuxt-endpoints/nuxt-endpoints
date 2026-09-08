import { z } from 'zod'
const PlaygroundUser = z.object({
  id: z.number(),
  name: z.string(),
  createdAt: z.string(),
})
export default defineEndpoint({
  summary: 'Persist a user in the playground SQLite database',
  request: {
    body: z.object({
      name: z.string().trim().min(1).max(80),
    }),
  },
  responses: {
    201: PlaygroundUser,
  },
  idempotency: true,
  handler: (event) => event.respond(201, createPlaygroundUser(event.validated.body.name)),
})
