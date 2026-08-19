import { z } from 'zod'
import {
  defineEndpoint,
  defineEndpointMethodHandlers,
  defineEndpointMethods,
} from '../../../../../src/runtime'

export const endpoints = defineEndpointMethods({
  get: defineEndpoint({
    operation: 'getMulti',
    query: z.object({ name: z.string().default('multi') }),
    response: z.object({ name: z.string() }),
  }),
  put: defineEndpoint({
    operation: 'putMulti',
    body: z.object({ name: z.string() }),
    responses: {
      200: z.object({ name: z.string() }),
    },
  }),
})

export default defineEndpointMethodHandlers(endpoints, {
  get: ({ query }) => ({ name: query.name }),
  put: ({ body, respond }) => respond(200, { name: body.name }),
})
