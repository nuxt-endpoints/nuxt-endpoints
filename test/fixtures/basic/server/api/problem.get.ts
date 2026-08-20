import { z } from 'zod'
import { defineEndpoint, defineEndpointHandler } from '../../../../../src/runtime'

export const endpoint = defineEndpoint({
  operation: 'getProblem',
  responses: {
    200: z.object({ ok: z.literal(true) }),
    404: {
      body: z.object({ type: z.string(), title: z.string(), status: z.number() }),
      contentType: 'application/problem+json',
    },
  },
})

export default defineEndpointHandler(endpoint, ({ respond }) => {
  return respond(404, {
    type: 'https://example.com/probs/not-found',
    title: 'Not Found',
    status: 404,
  })
})
