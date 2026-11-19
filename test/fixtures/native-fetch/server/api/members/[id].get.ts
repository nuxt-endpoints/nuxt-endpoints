import { z } from 'zod'

export default defineEndpoint({
  validate: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: z.object({ name: z.string() }),
    404: z.object({ reason: z.literal('member_not_found') }),
  },
  handler({ validated }) {
    return { name: validated.params.id }
  },
})
