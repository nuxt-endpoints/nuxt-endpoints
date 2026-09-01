import { z } from 'zod'
import { defineRouteHandler } from '../../../../../src/runtime'

const operation = 'getDynamic'

export default defineRouteHandler({
  operation,
  validate: {
    response: {
      200: z.object({
        ok: z.literal(true),
      }),
    },
  },
  handler: () => {
    return { ok: true } as const
  },
})
