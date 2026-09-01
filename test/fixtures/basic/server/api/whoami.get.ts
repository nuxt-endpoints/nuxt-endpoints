import { getCookie } from 'h3'
import { z } from 'zod'
import { defineRouteHandler } from '../../../../../src/runtime'

export default defineRouteHandler({
  validate: {
    response: {
      200: z.object({
        user: z.string(),
      }),
    },
  },
  handler: async (event) => {
    const user = getCookie(event, 'session') ?? 'anonymous'

    // Keep concurrent SSR requests overlapping long enough to exercise
    // request-scoped QueryClient isolation in the integration fixture.
    await new Promise((resolve) => setTimeout(resolve, 25))

    return { user }
  },
})
