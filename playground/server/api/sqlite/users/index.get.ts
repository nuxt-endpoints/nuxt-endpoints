import { z } from 'zod'

const PlaygroundUser = z.object({
  id: z.number(),
  name: z.string(),
  createdAt: z.string(),
})

export const endpoint = defineEndpoint({
  operation: 'listSqliteUsers',
  summary: 'List users persisted in the playground SQLite database',
  response: z.object({
    items: z.array(PlaygroundUser),
  }),
})

export default defineEndpointHandler(endpoint, () => {
  return {
    items: listPlaygroundUsers(),
  }
})
