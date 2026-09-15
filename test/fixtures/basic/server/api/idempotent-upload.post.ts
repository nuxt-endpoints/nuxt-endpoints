import { z } from 'zod'
import { defineEndpoint } from '../../../../../src/runtime'
let executionCount = 0
export default defineEndpoint({
  request: {
    body: {
      'multipart/form-data': z.object({
        name: z.string(),
        file: z.file().mime('text/plain'),
      }),
    },
  },
  responses: {
    201: z.object({ executionCount: z.number(), name: z.string() }),
  },
  idempotency: true,
  handler: (event) => {
    executionCount += 1
    return event.respond(201, {
      executionCount,
      name: event.validated.body.name,
    })
  },
})
