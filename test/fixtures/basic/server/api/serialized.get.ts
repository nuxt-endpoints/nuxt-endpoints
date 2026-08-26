import { z } from 'zod'
import { defineEndpoint, defineEndpointHandler } from '../../../../../src/runtime'

const SerializedResponse = z.object({
  createdAt: z.date(),
})

export const endpoint = defineEndpoint(
  {
    operation: 'getSerialized',
    responses: { 200: SerializedResponse },
  },
  {
    validation: {
      response: true,
    },
  },
)

export default defineEndpointHandler(endpoint, () => ({
  createdAt: new Date('2026-08-14T00:00:00.000Z'),
}))
