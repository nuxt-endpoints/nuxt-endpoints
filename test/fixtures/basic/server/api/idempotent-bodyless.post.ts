import { z } from 'zod'
import { defineRouteHandler } from '../../../../../src/runtime'

let executionCount = 0

export default defineRouteHandler({
  validate: {
    response: {
      201: z.object({ executionCount: z.number() }),
      409: z.object({ executionCount: z.number() }),
    },
  },
  idempotency: {
    enabled: true,
    headerName: 'Idempotency-Key',
    required: true,
  },
  handler: (event) => {
    executionCount += 1
    return event.respond(409, { executionCount })
  },
})
