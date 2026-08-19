import { createMemoryIdempotencyStorage, defineEndpointRuntime } from '../../../../../src/runtime'

const storage = createMemoryIdempotencyStorage()

export default defineEndpointRuntime({
  onValidationError: (failure) => ({
    status: 422,
    body: {
      error: 'contract',
      kind: failure.kind,
      source: failure.source,
    },
  }),
  wrapHandler: async (context, next) => {
    const response = await next()
    return {
      ...response,
      headers: { ...response.headers, 'x-wrapped': String(context.event.method ?? 'unknown') },
    }
  },
  idempotency: {
    storage: () => storage,
    scope: () => 'integration-fixture',
    authorization: 'middleware',
  },
})
