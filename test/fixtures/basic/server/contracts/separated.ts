import { z } from 'zod'

export const separatedContract = {
  query: z.object({ name: z.string().default('separated') }),
  responses: { 200: z.object({ name: z.string(), separated: z.boolean() }) },
}
