import { z } from 'zod'
import { defineRouteHandler } from '../../../../../src/runtime'

let executionCount = 0

export default defineRouteHandler({
  validate: {
    body: {
      'multipart/form-data': z.object({
        name: z.string(),
        file: z.file().mime('text/plain'),
      }),
    },
    response: {
      201: z.object({ executionCount: z.number(), name: z.string() }),
    },
  },
  idempotency: {
    enabled: true,
    headerName: 'Idempotency-Key',
    required: true,
  },
  handler: (event) => {
    executionCount += 1
    return event.respond(201, {
      executionCount,
      name: event.validated.body.name,
    })
  },
})
