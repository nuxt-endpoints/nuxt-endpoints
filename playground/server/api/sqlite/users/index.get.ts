import { z } from 'zod'
import { defineEndpoint } from '../../../../../src/runtime'
import { listPlaygroundUsers } from '../../../utils/database'
const PlaygroundUser = z.object({
  id: z.number(),
  name: z.string(),
  createdAt: z.string(),
})
export default defineEndpoint({
  summary: 'List users persisted in the playground SQLite database',
  responses: {
    200: z.object({
      items: z.array(PlaygroundUser),
    }),
  },
  handler: () => ({ items: listPlaygroundUsers() }),
})
