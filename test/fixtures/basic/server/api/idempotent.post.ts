import { z } from 'zod'
import {
  createMemoryIdempotencyStorage,
  defineEndpoint,
  defineEndpointHandler,
} from '../../../../../src/runtime'

const storage = createMemoryIdempotencyStorage()
let executionCount = 0

export const endpoint = defineEndpoint({
  operation: 'createIdempotentItem',
  body: z.object({ amount: z.number().positive() }),
  responses: {
    201: z.object({ id: z.number(), amount: z.number() }),
  },
}).idempotency({
  storage: () => storage,
  scope: () => 'integration-fixture',
  authorization: 'middleware',
  required: true,
})

export default defineEndpointHandler(endpoint, ({ body, respond }) => {
  executionCount += 1
  return respond(201, { id: executionCount, amount: body.amount })
})
