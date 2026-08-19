import { defineEndpointHooks } from '../../../../../src/runtime'

export default defineEndpointHooks({
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
})
