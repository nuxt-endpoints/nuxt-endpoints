import { z } from 'zod'
import { defineRouteHandler } from '../../../../../src/runtime'

const SerializedResponse = z.object({
  createdAt: z.date(),
})

const SerializedErrorResponse = z.object({
  rejectedAt: z.date(),
})

export default defineRouteHandler(
  {
    operation: 'getSerialized',
    validate: {
      query: z.object({ fail: z.literal('true').optional() }),
      response: { 200: SerializedResponse, 422: SerializedErrorResponse },
    },
    handler: ({ query, respond }) =>
      query.fail
        ? respond(422, { rejectedAt: new Date('2026-08-15T00:00:00.000Z') })
        : { createdAt: new Date('2026-08-14T00:00:00.000Z') },
  },
  {
    validation: {
      response: true,
    },
  },
)
