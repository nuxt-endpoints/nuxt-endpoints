import { z } from 'zod'

const PlaygroundUser = z.object({
  id: z.number(),
  name: z.string(),
  createdAt: z.string(),
})

export default defineEndpoint({
  operation: 'listSqliteUsers',
  summary: 'List users persisted in the playground SQLite database',
  responses: {
    200: z.object({
      items: z.array(PlaygroundUser),
    }),
  },
  handler: () => {
    return {
      items: listPlaygroundUsers(),
    }
  },
})
