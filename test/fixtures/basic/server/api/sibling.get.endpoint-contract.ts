import { z } from 'zod'

export const siblingContract = {
  query: z.object({ name: z.string().default('sibling') }),
  responses: { 200: z.object({ name: z.string(), sibling: z.boolean() }) },
}
