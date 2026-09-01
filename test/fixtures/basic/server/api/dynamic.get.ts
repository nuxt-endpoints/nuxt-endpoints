import { z } from 'zod'
import { defineRouteHandler } from '../../../../../src/runtime'

export default defineRouteHandler({
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
