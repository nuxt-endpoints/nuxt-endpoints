import { z } from 'zod'
import { defineEndpoint, defineEndpointHandler } from '../../../../../src/runtime'

export const endpoint = defineEndpoint({
  query: z.object({
    q: z.string(),
  }),
  response: z.object({
    items: z.array(z.string()),
  }),
})

export default defineEndpointHandler(endpoint, ({ query }) => {
  return {
    items: [query.q],
  }
})
