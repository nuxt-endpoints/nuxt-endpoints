import { describe, expectTypeOf, it } from 'vitest'
import { defineEndpointRuntime } from '../../src/runtime'

describe('defineEndpointRuntime route overrides', () => {
  it('keeps application policy separate from the four idempotency overrides', () => {
    defineEndpointRuntime({
      wrapHandler: async (_context, next) => next(),
      routes: {
        '/api/items/:id': {
          post: {
            onValidationError: () => undefined,
            idempotency: {
              fingerprint: ({ params, query, body }) => {
                expectTypeOf(params).toEqualTypeOf<unknown>()
                expectTypeOf(query).toEqualTypeOf<unknown>()
                expectTypeOf(body).toEqualTypeOf<unknown>()
                return { params, query, body }
              },
              replayStatuses: [409],
              leaseTtlMs: 30_000,
              replayTtlMs: 60_000,
            },
          },
        },
      },
    })

    defineEndpointRuntime({
      routes: {
        '/api/items': {
          post: {
            idempotency: {
              // @ts-expect-error storage is application policy, not a route override
              storage: () => ({}),
            },
          },
        },
      },
    })

    defineEndpointRuntime({
      routes: {
        '/api/items': {
          post: {
            // @ts-expect-error wrapHandler is application-wide
            wrapHandler: async (_context: unknown, next: () => unknown) => next(),
          },
        },
      },
    })
  })
})
