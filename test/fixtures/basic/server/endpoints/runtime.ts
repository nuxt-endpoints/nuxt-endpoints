import { createMemoryIdempotencyStorage, defineEndpointRuntime } from '../../../../../src/runtime'

const storage = createMemoryIdempotencyStorage()

export default defineEndpointRuntime({
  routes: {
    '/api/idempotent-bodyless': {
      post: {
        idempotency: {
          fingerprint: () => ({ operation: 'bodyless-conflict' }),
          replayStatuses: [409],
          leaseTtlMs: 15_000,
          replayTtlMs: 60_000,
        },
      },
    },
    '/api/idempotent-upload': {
      post: {
        idempotency: {
          fingerprint: ({ body }) => {
            const input = body as { name: string; file: File }
            return {
              name: input.name,
              file: {
                name: input.file.name,
                size: input.file.size,
                type: input.file.type,
              },
            }
          },
        },
      },
    },
    '/api/runtime-hooks': {
      post: {
        onValidationError: (failure) => {
          if (failure.source === 'query') {
            return { status: 409, body: { error: 'route', source: failure.source } }
          }
        },
      },
    },
  },
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
  openApi: {
    document: {
      servers: [{ url: 'https://api.example.test' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
    },
    extend: (document) => {
      document.security = [{ bearerAuth: [] }]
    },
  },
})
