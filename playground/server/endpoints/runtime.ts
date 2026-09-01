import { defineEndpointRuntime } from '../../../src/runtime'
import { getPlaygroundIdempotencyStorage } from '../utils/sqlite-idempotency-storage'

export default defineEndpointRuntime({
  idempotency: {
    storage: getPlaygroundIdempotencyStorage,
    scope: () => 'playground',
    authorization: 'middleware',
  },
})
