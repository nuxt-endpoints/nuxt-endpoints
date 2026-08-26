import { z } from 'zod'
import { defineEndpoint, defineEndpointHandler } from '../../../../../src/runtime'

const operation = 'getDynamic'

export const endpoint = defineEndpoint({
  operation,
  responses: {
    200: z.object({
      ok: z.literal(true),
    }),
  },
})

export default defineEndpointHandler(endpoint, () => {
  return {
    ok: true,
  } as const
})
