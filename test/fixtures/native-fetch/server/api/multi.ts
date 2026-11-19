import { z } from 'zod'

export default defineEndpoint({
  get: {
    validate: { query: z.object({ limit: z.enum(['1', '3']).transform(Number) }) },
    responses: { 200: z.object({ count: z.number() }) },
    handler: (event) => ({ count: event.validated.query.limit }),
  },
  put: {
    validate: { body: z.object({ name: z.string() }) },
    responses: {
      200: z.object({ updated: z.boolean() }),
      409: z.object({ reason: z.literal('duplicate') }),
    },
    handler: (event) => event.respond(409, { reason: 'duplicate' }),
  },
})
