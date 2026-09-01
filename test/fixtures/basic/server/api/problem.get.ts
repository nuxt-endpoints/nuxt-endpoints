import { z } from 'zod'
import { defineRouteHandler } from '../../../../../src/runtime'

export default defineRouteHandler({
  validate: {
    response: {
      200: z.object({ ok: z.literal(true) }),
      404: {
        body: z.object({ type: z.string(), title: z.string(), status: z.number() }),
        contentType: 'application/problem+json',
      },
    },
  },
  handler: (event) =>
    event.respond(404, {
      type: 'https://example.com/probs/not-found',
      title: 'Not Found',
      status: 404,
    }),
})
