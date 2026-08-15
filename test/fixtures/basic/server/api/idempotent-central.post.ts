import { z } from 'zod'
import { defineEndpoint, defineEndpointHandler } from '../../../../../src/runtime'

let executionCount = 0

export const endpoint = defineEndpoint({
  operation: 'createIdempotentCentralItem',
  body: z.object({ amount: z.number().positive() }),
  responses: {
    201: z.object({ id: z.number(), amount: z.number() }),
  },
}).idempotency({
  required: true,
  replayStatuses: [201],
})

export default defineEndpointHandler(endpoint, ({ body, respond }) => {
  executionCount += 1
  return respond(201, { id: executionCount, amount: body.amount })
})
