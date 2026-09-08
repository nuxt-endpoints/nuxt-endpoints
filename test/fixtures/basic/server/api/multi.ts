import { z } from 'zod'
import { defineEndpoint } from '../../../../../src/runtime'
export default defineEndpoint({
  get: {
    request: {
      query: z.object({ name: z.string().default('multi') }),
    },
    responses: { 200: z.object({ name: z.string() }) },
    handler: (event) => ({ name: event.validated.query.name }),
  },
  put: {
    request: {
      body: z.object({ name: z.string() }),
    },
    responses: { 200: z.object({ name: z.string() }) },
    handler: (event) => event.respond(200, { name: event.validated.body.name }),
  },
})
