import { z } from 'zod'
import { defineRouteHandler } from '../../../../../src/runtime'
import { listPlaygroundUsers } from '../../../utils/database'

const PlaygroundUser = z.object({
  id: z.number(),
  name: z.string(),
  createdAt: z.string(),
})

export default defineRouteHandler({
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
