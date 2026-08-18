import { z } from 'zod'
import { defineEndpoint, defineEndpointHandler } from '../../../../../src/runtime'

export const endpoint = defineEndpoint({
  operation: 'createUpload',
  body: {
    'application/json': z.object({ name: z.string() }),
    'multipart/form-data': z.object({ name: z.string() }),
  },
  responses: {
    201: z.object({ name: z.string(), bodyMediaType: z.string() }),
  },
})

export default defineEndpointHandler(endpoint, ({ body, bodyMediaType, respond }) => {
  return respond(201, { name: body.name, bodyMediaType })
})
