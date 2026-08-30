import { z } from 'zod'
import { defineEndpoint, defineEndpointHandler } from '../../../../../src/runtime'

const SerializedResponse = z.object({
  createdAt: z.date(),
})

const SerializedErrorResponse = z.object({
  rejectedAt: z.date(),
})

export const endpoint = defineEndpoint(
  {
    operation: 'getSerialized',
    query: z.object({ fail: z.literal('true').optional() }),
    responses: { 200: SerializedResponse, 422: SerializedErrorResponse },
  },
  {
    validation: {
      response: true,
    },
  },
)

export default defineEndpointHandler(endpoint, ({ query, respond }) =>
  query.fail
    ? respond(422, { rejectedAt: new Date('2026-08-15T00:00:00.000Z') })
    : { createdAt: new Date('2026-08-14T00:00:00.000Z') },
)
