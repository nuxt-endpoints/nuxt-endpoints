import { z } from 'zod'
import { defineEndpoint } from '../../../../../src/runtime'

export const siblingEndpoint = defineEndpoint({
  operation: 'getSibling',
  query: z.object({ name: z.string().default('sibling') }),
  responses: { 200: z.object({ name: z.string(), sibling: z.boolean() }) },
})
