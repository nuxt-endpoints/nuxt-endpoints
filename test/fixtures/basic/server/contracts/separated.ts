import { z } from 'zod'
import { defineEndpoint } from '../../../../../src/runtime'

export const separatedEndpoint = defineEndpoint({
  operation: 'getSeparated',
  query: z.object({ name: z.string().default('separated') }),
  response: z.object({ name: z.string(), separated: z.boolean() }),
})
