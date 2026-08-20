import { describe, expectTypeOf, it } from 'vitest'
import { Effect } from 'effect'
import type {
  EffectEndpointClient,
  EndpointClientError,
  UseEndpointEffectClient,
} from '../../src/runtime/effect'
import type { EndpointResult, StandardSchemaLike } from '../../src/runtime'

type Schema<INPUT, OUTPUT = INPUT> = StandardSchemaLike<INPUT, OUTPUT>

type UserRoute = {
  path: '/api/users/:id'
  method: 'get'
  operation: 'getUser'
  definition: {
    operation: 'getUser'
    params: Schema<{ id: string }, { id: number }>
    responses: {
      200: Schema<{ id: number; name: string }>
      404: Schema<{ message: string }>
    }
  }
}

type PaymentRoute = {
  path: '/api/payments'
  method: 'post'
  operation: 'createPayment'
  definition: {
    operation: 'createPayment'
    idempotency: {
      enabled: true
      headerName: 'Idempotency-Key'
      required: true
    }
    response: Schema<{ id: string }>
  }
}

type Client = EffectEndpointClient<UserRoute>
type UseEffectClient = UseEndpointEffectClient<UserRoute>
type MinimalClient = EffectEndpointClient<
  UserRoute,
  {
    result: false
    raw: false
  }
>

declare const client: Client
declare const useEffectClient: UseEffectClient
declare const minimalClient: MinimalClient
declare const paymentClient: EffectEndpointClient<PaymentRoute>
declare const usePaymentEffectClient: UseEndpointEffectClient<PaymentRoute>

describe('EffectEndpointClient', () => {
  it('types Effect calls from endpoint responses', () => {
    const call = client('/api/users/:id', { method: 'get', params: { id: '1' } })
    const operationCall = client('getUser', { params: { id: '1' } })
    const aliasCall = client.getUser({ params: { id: '1' } })

    expectTypeOf(call.effect()).toEqualTypeOf<
      Effect.Effect<EndpointResult<UserRoute>, EndpointClientError>
    >()
    expectTypeOf(operationCall.effect()).toEqualTypeOf<
      Effect.Effect<EndpointResult<UserRoute>, EndpointClientError>
    >()
    expectTypeOf(aliasCall.effect()).toEqualTypeOf<
      Effect.Effect<EndpointResult<UserRoute>, EndpointClientError>
    >()
  })

  it('narrows endpoint result statuses in Effect pipelines', () => {
    const recovered = client('/api/users/:id', { method: 'get', params: { id: '1' } })
      .effect()
      .pipe(
        Effect.map((result) => {
          if (result.status === 404) {
            expectTypeOf(result.body).toEqualTypeOf<{ message: string }>()
            return null
          }
          return result.body
        }),
      )

    expectTypeOf(recovered).toEqualTypeOf<
      Effect.Effect<{ id: number; name: string } | null, EndpointClientError>
    >()
  })

  it('types useEndpointEffect data from the composed Effect program', () => {
    const state = useEffectClient(
      '/api/users/:id',
      { method: 'get', params: { id: '1' }, lazy: true },
      (program) =>
        program.pipe(
          Effect.retry({ times: 2 }),
          Effect.map((result) => {
            if (result.status === 404) {
              return null
            }
            return result.body
          }),
        ),
    )

    expectTypeOf(state.data.value).toEqualTypeOf<{ id: number; name: string } | null | undefined>()
    expectTypeOf(state.error.value).toEqualTypeOf<EndpointClientError | undefined>()

    const operationState = useEffectClient('getUser', { params: { id: '1' } }, (program) =>
      program.pipe(Effect.map((result) => (result.status === 404 ? null : result.body))),
    )
    expectTypeOf(operationState.data.value).toEqualTypeOf<
      { id: number; name: string } | null | undefined
    >()

    // @ts-expect-error useEndpointEffect does not expose property aliases.
    useEffectClient.getUser({ params: { id: '1' } })
    // @ts-expect-error operation calls do not take method.
    useEffectClient('getUser', { method: 'get', params: { id: '1' } })
  })

  it('keeps Effect calls while hiding disabled optional client calls', () => {
    const call = minimalClient('/api/users/:id', { method: 'get', params: { id: '1' } })
    const operationCall = minimalClient('getUser', { params: { id: '1' } })
    const aliasCall = minimalClient.getUser({ params: { id: '1' } })
    call.effect()
    operationCall.effect()
    aliasCall.effect()

    // @ts-expect-error result is disabled for this client.
    call.result()
    // @ts-expect-error raw is disabled for this client.
    call.raw()
    // @ts-expect-error result is disabled for this client.
    operationCall.result()
    // @ts-expect-error raw is disabled for this client.
    operationCall.raw()
    // @ts-expect-error result is disabled for this client.
    aliasCall.result()
    // @ts-expect-error raw is disabled for this client.
    aliasCall.raw()
  })

  it('propagates required idempotency keys through Effect clients', () => {
    paymentClient('/api/payments', { method: 'post', idempotencyKey: 'request-1' }).effect()
    paymentClient('createPayment', { idempotencyKey: 'request-1' }).effect()
    paymentClient.createPayment({ idempotencyKey: 'request-1' }).effect()
    usePaymentEffectClient('createPayment', { idempotencyKey: 'request-1' })

    // @ts-expect-error required idempotency key is preserved by Effect client calls.
    paymentClient('createPayment').effect()
    // @ts-expect-error required idempotency key is preserved by useEndpointEffect.
    usePaymentEffectClient('createPayment')
  })
})
