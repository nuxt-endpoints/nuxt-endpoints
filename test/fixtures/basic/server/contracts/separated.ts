import { z } from 'zod'
import { defineEndpoint } from '../../../../../src/runtime'

export const separatedEndpoint = defineEndpoint({
  operation: 'getSeparated',
  query: z.object({ name: z.string().default('separated') }),
  responses: { 200: z.object({ name: z.string(), separated: z.boolean() }) },
})
