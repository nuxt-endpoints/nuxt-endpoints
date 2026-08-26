import { getCookie } from 'h3'
import { z } from 'zod'
import { defineEndpoint, defineEndpointHandler } from '../../../../../src/runtime'

export const endpoint = defineEndpoint({
  operation: 'whoami',
  responses: {
    200: z.object({
      user: z.string(),
    }),
  },
})

export default defineEndpointHandler(endpoint, async ({ event }) => {
  const user = getCookie(event, 'session') ?? 'anonymous'

  // Keep concurrent SSR requests overlapping long enough to exercise
  // request-scoped QueryClient isolation in the integration fixture.
  await new Promise((resolve) => setTimeout(resolve, 25))

  return { user }
})
