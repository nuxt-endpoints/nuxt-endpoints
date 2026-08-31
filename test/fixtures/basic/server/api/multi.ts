import { z } from 'zod'
import { defineRouteHandler } from '../../../../../src/runtime'

export default defineRouteHandler({
  get: {
    operation: 'getMulti',
    validate: {
      query: z.object({ name: z.string().default('multi') }),
      response: { 200: z.object({ name: z.string() }) },
    },
    handler: ({ query }) => ({ name: query.name }),
  },
  put: {
    operation: 'putMulti',
    validate: {
      body: z.object({ name: z.string() }),
      response: { 200: z.object({ name: z.string() }) },
    },
    handler: ({ body, respond }) => respond(200, { name: body.name }),
  },
})
