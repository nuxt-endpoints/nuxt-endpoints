import { z } from 'zod'

const PlaygroundUser = z.object({
  id: z.number(),
  name: z.string(),
  createdAt: z.string(),
})

export default defineRouteHandler({
  operation: 'listSqliteUsers',
  summary: 'List users persisted in the playground SQLite database',
  validate: {
    response: {
      200: z.object({
        items: z.array(PlaygroundUser),
      }),
    },
  },
  handler: () => ({ items: listPlaygroundUsers() }),
})
