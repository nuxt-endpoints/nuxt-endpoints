import { QueryClient, useMutation, useQuery } from '@tanstack/vue-query'
import { describe, expectTypeOf, it } from 'vitest'
import type { EndpointResultData } from '../../src/runtime/client'
import type {
  EndpointMutationOptionsClient,
  EndpointQueryKey,
  EndpointQueryOptionsClient,
  EndpointTaggedQueryKey,
} from '../../src/runtime/tanstack-query'
import type { StandardSchemaLike } from '../../src/runtime'

type Schema<INPUT, OUTPUT = INPUT> = StandardSchemaLike<INPUT, OUTPUT>

type Routes =
  | {
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
  | {
      path: '/api/health'
      method: 'get'
      operation: 'health'
      definition: {
        operation: 'health'
        response: Schema<{ ok: true }>
      }
    }
  | {
      path: '/api/users'
      method: 'post'
      operation: 'createUser'
      definition: {
        operation: 'createUser'
        body: Schema<{ name: string }>
        responses: {
          201: Schema<{ id: number; name: string }>
          400: Schema<{ message: string }>
        }
      }
    }
  | {
      path: '/api/ping'
      method: 'post'
      operation: 'ping'
      definition: {
        operation: 'ping'
        response: Schema<{ ok: true }>
      }
    }
  | {
      path: '/api/reports'
      method: 'get'
      definition: {
        response: Schema<{ items: string[] }>
      }
    }
  | {
      path: '/api/retry-ping'
      method: 'post'
      operation: 'retryPing'
      definition: {
        operation: 'retryPing'
        idempotency: {
          enabled: true
          headerName: 'Idempotency-Key'
          required: true
        }
        response: Schema<{ ok: true }>
      }
    }
  | {
      path: '/api/retry-health'
      method: 'get'
      operation: 'retryHealth'
      definition: {
        operation: 'retryHealth'
        idempotency: {
          enabled: true
          headerName: 'Idempotency-Key'
          required: false
        }
        response: Schema<{ ok: true }>
      }
    }

declare const queryClient: EndpointQueryOptionsClient<Routes>
declare const mutationClient: EndpointMutationOptionsClient<Routes>
declare const queryClientInstance: QueryClient

describe('EndpointQueryOptionsClient / EndpointMutationOptionsClient types', () => {
  it('exposes GET/HEAD operations for the query client and POST/PUT/PATCH/DELETE for the mutation client', () => {
    expectTypeOf<keyof typeof queryClient>().toEqualTypeOf<'getUser' | 'health' | 'retryHealth'>()
    expectTypeOf<keyof typeof mutationClient>().toEqualTypeOf<'createUser' | 'ping' | 'retryPing'>()
  })

  it('requires request input matching the endpoint options', () => {
    queryClient.getUser({ params: { id: '1' } })

    // @ts-expect-error params is required for getUser.
    queryClient.getUser({})
    // @ts-expect-error a request is required when the endpoint declares options.
    queryClient.getUser()
    // @ts-expect-error unknown fields are rejected.
    queryClient.getUser({ params: { id: '1' }, bogus: true })

    mutationClient.createUser().mutationFn({ body: { name: 'Tom' } })
    // @ts-expect-error body is required for createUser mutations.
    mutationClient.createUser().mutationFn({})
  })

  it('accepts getter input and keyScope in both plain and getter form', () => {
    queryClient.getUser(() => ({ params: { id: '1' } }))
    queryClient.getUser({ params: { id: '1' }, keyScope: 'scope' })
    queryClient.getUser(() => ({ params: { id: '1' }, keyScope: 'scope' }))

    expectTypeOf<EndpointQueryKey>().toEqualTypeOf<readonly unknown[]>()
  })

  it('types the `key()` overloads: untagged prefix with no argument, tagged exact key with a request', () => {
    // `ReturnType<typeof factory.key>` would resolve to the *last* overload
    // signature, not the no-arg one - so these assertions are made on value
    // expressions (actual calls) instead, one per overload branch.

    // No-arg: the untagged operation-prefix key. It is a filter matching every
    // cached variant of the operation (data, result, and infinite caches
    // alike), so it cannot honestly carry a single DATA tag.
    expectTypeOf(queryClient.getUser.key()).toEqualTypeOf<EndpointQueryKey>()
    expectTypeOf(queryClient.getUser.result.key()).toEqualTypeOf<EndpointQueryKey>()

    // With a request: the exact, DataTag-branded key for that request.
    expectTypeOf(queryClient.getUser.key({ params: { id: '1' } })).toEqualTypeOf<
      EndpointTaggedQueryKey<{ id: number; name: string }>
    >()
    expectTypeOf(queryClient.getUser.result.key({ params: { id: '1' } })).toEqualTypeOf<
      EndpointTaggedQueryKey<EndpointResultData<Extract<Routes, { operation: 'getUser' }>>>
    >()
  })

  it('types getQueryData through a tagged key as the route success body, or undefined', () => {
    const data = queryClientInstance.getQueryData(queryClient.getUser.key({ params: { id: '1' } }))

    expectTypeOf(data).toEqualTypeOf<{ id: number; name: string } | undefined>()
  })

  it('types getQueryData through a tagged result-mode key as the status union sans headers, or undefined', () => {
    const data = queryClientInstance.getQueryData(
      queryClient.getUser.result.key({ params: { id: '1' } }),
    )

    expectTypeOf(data).toEqualTypeOf<
      EndpointResultData<Extract<Routes, { operation: 'getUser' }>> | undefined
    >()
  })

  it('types queryFn data as the route success body', () => {
    const options = queryClient.getUser({ params: { id: '1' } })

    expectTypeOf<Awaited<ReturnType<typeof options.queryFn>>>().toEqualTypeOf<{
      id: number
      name: string
    }>()
  })

  it('types result-mode queryFn as the declared status union without headers', () => {
    const options = queryClient.getUser.result({ params: { id: '1' } })
    type ResultData = Awaited<ReturnType<typeof options.queryFn>>

    expectTypeOf<ResultData>().toEqualTypeOf<
      EndpointResultData<Extract<Routes, { operation: 'getUser' }>>
    >()

    const result = options.queryFn({
      signal: new AbortController().signal,
      queryKey: options.queryKey as EndpointQueryKey,
    })
    void result.then((value) => {
      // @ts-expect-error result-mode data is serializable and excludes headers.
      void value.headers
    })
  })

  it('infers mutation variables from the endpoint options, including void for void-input mutations', () => {
    const createUserMutation = mutationClient.createUser()
    type CreateUserVariables = Parameters<typeof createUserMutation.mutationFn>[0]
    expectTypeOf<CreateUserVariables>().toEqualTypeOf<{ body: { name: string } }>()

    const pingMutation = mutationClient.ping()
    // A void-input mutation accepts no variables, or `undefined`.
    pingMutation.mutationFn()
    pingMutation.mutationFn(undefined)

    const retryPingMutation = mutationClient.retryPing()
    retryPingMutation.mutationFn({ idempotencyKey: 'request-1' })
    // @ts-expect-error required idempotency key is part of mutation variables.
    retryPingMutation.mutationFn()

    queryClient.retryHealth()
    queryClient.retryHealth({ idempotencyKey: 'request-1' })

    // @ts-expect-error name must be a string.
    createUserMutation.mutationFn({ body: { name: 1 } })
  })

  it('fails to compile when accessing a non-existent operation', () => {
    // @ts-expect-error unknown operation.
    void queryClient.doesNotExist
    // @ts-expect-error unknown operation.
    void mutationClient.doesNotExist
  })

  it('interoperates with real useQuery/useMutation types', () => {
    const userQuery = useQuery(queryClient.getUser({ params: { id: '1' } }), queryClientInstance)
    expectTypeOf(userQuery.data.value).toEqualTypeOf<{ id: number; name: string } | undefined>()

    const createUser = useMutation(mutationClient.createUser(), queryClientInstance)
    createUser.mutate({ body: { name: 'Tom' } })
    // @ts-expect-error mutate rejects variables that do not match the endpoint body.
    createUser.mutate({ body: { name: 1 } })
  })
})
