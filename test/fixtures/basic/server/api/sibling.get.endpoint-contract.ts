import { z } from 'zod'
import { defineEndpoint } from '../../../../../src/runtime'

export const siblingEndpoint = defineEndpoint({
  operation: 'getSibling',
  query: z.object({ name: z.string().default('sibling') }),
  response: z.object({ name: z.string(), sibling: z.boolean() }),
})
