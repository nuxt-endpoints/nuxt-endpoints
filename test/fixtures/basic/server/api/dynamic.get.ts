import { z } from 'zod'
import { defineEndpoint, defineEndpointHandler } from '../../../../../src/runtime'

const operation = 'getDynamic'

export const endpoint = defineEndpoint({
  operation,
  response: z.object({
    ok: z.literal(true),
  }),
})

export default defineEndpointHandler(endpoint, () => {
  return {
    ok: true,
  } as const
})
