// Registered through `nitro.handlers` in nuxt.config.ts rather than by file
// scanning, and deliberately outside every scanned directory so scanning
// cannot also pick it up. Discovery reads Nitro's explicitly configured
// handlers alongside its scanned ones, so this is an ordinary endpoint.
import { z } from 'zod'
import { defineRouteHandler } from '../../../../../src/runtime'

export default defineRouteHandler({
  operation: 'getCustomReport',
  validate: {
    query: z.object({ id: z.string() }),
    response: {
      200: z.object({ id: z.string(), source: z.literal('custom-route') }),
    },
  },
  handler: ({ query, respond }) => {
    return respond(200, { id: query.id, source: 'custom-route' })
  },
})
