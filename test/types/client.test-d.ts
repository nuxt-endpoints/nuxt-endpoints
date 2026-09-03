import { describe, expectTypeOf, it } from 'vitest'
import type { UseMutationOptions, UseQueryOptions } from '@pinia/colada'
import type {
  EndpointClient,
  EndpointRequestValidationProblem,
  EndpointResult,
  StandardSchemaLike,
  UseEndpointClient,
} from '../../src/runtime'

type Schema<INPUT, OUTPUT = INPUT> = StandardSchemaLike<INPUT, OUTPUT>

type Routes =
  | {
      path: '/api/users/:id'
      method: 'get'
      definition: {
        params: Schema<{ id: string }, { id: number }>
        responses: {
          200: Schema<{ id: number; name: string }>
          404: Schema<{ message: string }>
        }
      }
    }
  | {
      path: '/api/users'
      method: 'post'
      definition: {
        body: Schema<{ name: string }>
        responses: { 201: Schema<{ id: number; name: string }> }
        idempotency: { enabled: true; headerName: 'Idempotency-Key'; required: true }
      }
      serverResponses: {
        401: Schema<{ error: 'unauthorized' }>
        503: Schema<{ error: 'unavailable' }>
      }
    }
  | {
      path: '/api/uploads'
      method: 'post'
      definition: {
        body: {
          'application/json': Schema<{ name: string }>
          'application/octet-stream': true
        }
        responses: { 201: Schema<{ id: number }> }
      }
    }
  | {
      path: '/api/export'
      method: 'get'
      definition: {
        responses: {
          200: { media: readonly ['text/csv', 'application/pdf'] }
        }
      }
    }

declare const $endpoint: EndpointClient<Routes>
declare const useEndpoint: UseEndpointClient<Routes>

describe('path-based endpoint client types', () => {
  it('requires a path, method, and contract inputs', () => {
    $endpoint('/api/users/:id', { method: 'get', params: { id: '1' } })
    $endpoint('/api/users', { method: 'post', body: { name: 'Tom' } })
    $endpoint('/api/users', {
      method: 'post',
      body: { name: 'Tom' },
      idempotencyKey: true,
    })

    // @ts-expect-error operation aliases were removed.
    $endpoint('getUser', { params: { id: '1' } })
    // @ts-expect-error the method is required.
    $endpoint('/api/users/:id', { params: { id: '1' } })
    // @ts-expect-error GET is not declared for this path.
    $endpoint('/api/users', { method: 'get' })
    // @ts-expect-error params use the schema input type.
    $endpoint('/api/users/:id', { method: 'get', params: { id: 1 } })
  })

  it('awaits to a status-discriminated result', async () => {
    const result = await $endpoint('/api/users/:id', {
      method: 'get',
      params: { id: '1' },
    })

    expectTypeOf(result).toEqualTypeOf<
      EndpointResult<Extract<Routes, { path: '/api/users/:id' }>>
    >()
    expectTypeOf(result.status).toEqualTypeOf<200 | 400 | 404>()
    if (result.status === 200) {
      expectTypeOf(result.body).toEqualTypeOf<{ id: number; name: string }>()
    } else if (result.status === 404) {
      expectTypeOf(result.status).toEqualTypeOf<404>()
      expectTypeOf(result.body).toEqualTypeOf<{ message: string }>()
    } else {
      expectTypeOf(result.status).toEqualTypeOf<400>()
      expectTypeOf(result.body.statusCode).toEqualTypeOf<400>()
    }

    const call = $endpoint('/api/users/:id', { method: 'get', params: { id: '1' } })
    // @ts-expect-error .result() was removed; awaiting the call is result-aware.
    call.result()
  })

  it('includes centrally configured server responses', async () => {
    const result = await $endpoint('/api/users', {
      method: 'post',
      body: { name: 'Tom' },
    })

    expectTypeOf(result.status).toEqualTypeOf<201 | 400 | 401 | 409 | 422 | 503>()

    if (result.status === 401) {
      expectTypeOf(result.body).toEqualTypeOf<{ error: 'unauthorized' }>()
    } else if (result.status === 503) {
      expectTypeOf(result.body).toEqualTypeOf<{ error: 'unavailable' }>()
    } else {
      expectTypeOf(result.status).toEqualTypeOf<201 | 400 | 409 | 422>()
    }
  })

  it('includes content-type and response-negotiation failures produced by NE', async () => {
    const upload = await $endpoint('/api/uploads', {
      method: 'post',
      body: { name: 'Tom' },
    })
    expectTypeOf(upload.status).toEqualTypeOf<201 | 400 | 415>()

    const exported = await $endpoint('/api/export', { method: 'get' })
    expectTypeOf(exported.status).toEqualTypeOf<200 | 406>()
    expectTypeOf(exported.body).toEqualTypeOf<ReadableStream<Uint8Array>>()
  })

  it('exposes Pinia Colada options on the same request object', () => {
    const getCall = $endpoint('/api/users/:id', { method: 'get', params: { id: '1' } })
    const query = getCall.queryOptions()
    expectTypeOf(query).toExtend<UseQueryOptions>()
    expectTypeOf(query.key).toEqualTypeOf<
      readonly ['nuxt-endpoints', 'v2', 'get', string, string]
    >()
    expectTypeOf(query.query).returns.resolves.toEqualTypeOf<
      | { status: 200; ok: true; body: { id: number; name: string } }
      | { status: 404; ok: false; body: { message: string } }
      | {
          status: 400
          ok: false
          body: EndpointRequestValidationProblem
        }
    >()
    // @ts-expect-error GET calls do not expose mutation options.
    getCall.mutationOptions()

    const postCall = $endpoint('/api/users', { method: 'post', body: { name: 'Tom' } })
    const mutation = postCall.mutationOptions()
    expectTypeOf(mutation).toExtend<UseMutationOptions>()
    // @ts-expect-error POST calls do not expose query options.
    postCall.queryOptions()
  })

  it('uses useEndpoint for serializable status data', () => {
    const state = useEndpoint('/api/users/:id', {
      method: 'get',
      params: { id: '1' },
      lazy: true,
    })

    expectTypeOf(state.data.value).toEqualTypeOf<
      | { status: 200; ok: true; body: { id: number; name: string } }
      | { status: 404; ok: false; body: { message: string } }
      | {
          status: 400
          ok: false
          body: EndpointRequestValidationProblem
        }
      | undefined
    >()
  })
})
