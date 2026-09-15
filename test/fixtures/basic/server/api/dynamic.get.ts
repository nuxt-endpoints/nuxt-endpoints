import { z } from 'zod'
import { defineEndpoint } from '../../../../../src/runtime'
export default defineEndpoint({
  responses: {
    200: z.object({
      ok: z.literal(true),
    }),
  },
  handler: () => {
    return { ok: true } as const
  },
})
