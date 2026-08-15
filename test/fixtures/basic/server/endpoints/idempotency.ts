import { createMemoryIdempotencyStorage, defineIdempotencyPolicy } from '../../../../../src/runtime'

const storage = createMemoryIdempotencyStorage()

export default defineIdempotencyPolicy({
  storage: () => storage,
  scope: () => 'integration-fixture',
  authorization: 'middleware',
})
