import { z } from 'zod'
import { defineEndpoint } from '../../../../../src/runtime'
let executionCount = 0
export default defineEndpoint({
  responses: {
    201: z.object({ executionCount: z.number() }),
    409: z.object({ executionCount: z.number() }),
  },
  idempotency: true,
  handler: (event) => {
    executionCount += 1
    return event.respond(409, { executionCount })
  },
})
