import { z } from 'zod'
import { defineRouteHandler } from '../../../../../src/runtime'

let executionCount = 0

export default defineRouteHandler({
  operation: 'createIdempotentItem',
  validate: {
    body: z.object({ amount: z.number().positive() }),
    response: {
      201: z.object({ id: z.number(), amount: z.number() }),
    },
  },
  idempotency: {
    enabled: true,
    headerName: 'Idempotency-Key',
    required: true,
  },
  handler: (event) => {
    executionCount += 1
    return event.respond(201, { id: executionCount, amount: event.validated.body.amount })
  },
})
