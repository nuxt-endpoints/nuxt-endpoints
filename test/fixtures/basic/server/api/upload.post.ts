import { z } from 'zod'
import { defineRouteHandler } from '../../../../../src/runtime'

export default defineRouteHandler({
  operation: 'createUpload',
  validate: {
    body: {
      'application/json': z.object({ name: z.string() }),
      'application/x-www-form-urlencoded': z.object({ name: z.string() }),
      'multipart/form-data': z.object({ name: z.string() }),
    },
    response: {
      201: z.object({ name: z.string(), bodyMediaType: z.string() }),
    },
  },
  handler: (event) => {
    return event.respond(201, {
      name: event.validated.body.name,
      bodyMediaType: event.bodyMediaType,
    })
  },
})
