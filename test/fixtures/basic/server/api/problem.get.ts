import { z } from 'zod'
import { defineEndpoint } from '../../../../../src/runtime'
export default defineEndpoint({
  responses: {
    200: z.object({ ok: z.literal(true) }),
    404: {
      body: z.object({ type: z.string(), title: z.string(), status: z.number() }),
      contentType: 'application/problem+json',
    },
  },
  handler: (event) =>
    event.respond(404, {
      type: 'https://example.com/probs/not-found',
      title: 'Not Found',
      status: 404,
    }),
})
