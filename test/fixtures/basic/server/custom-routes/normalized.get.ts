import { z } from 'zod'
import { defineEndpoint } from '../../../../../src/runtime'

export default defineEndpoint({
  responses: { 200: z.object({ normalized: z.literal(true) }) },
  handler: (event) => event.respond(200, { normalized: true }),
})
