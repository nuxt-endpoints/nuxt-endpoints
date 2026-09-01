import { z } from 'zod'
import { defineRouteHandler } from '../../../../../src/runtime'

export default defineRouteHandler({
  get: {
    operation: 'getMulti',
    validate: {
      query: z.object({ name: z.string().default('multi') }),
      response: { 200: z.object({ name: z.string() }) },
    },
    handler: (event) => ({ name: event.validated.query.name }),
  },
  put: {
    operation: 'putMulti',
    validate: {
      body: z.object({ name: z.string() }),
      response: { 200: z.object({ name: z.string() }) },
    },
    handler: (event) => event.respond(200, { name: event.validated.body.name }),
  },
})
