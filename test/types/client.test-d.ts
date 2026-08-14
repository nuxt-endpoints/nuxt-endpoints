import { describe, expectTypeOf, it } from 'vitest'
import type {
  EndpointClient,
  StatusResponse,
  StandardSchemaLike,
  UseEndpointClient,
  UseEndpointResultClient,
} from '../../src/runtime'

declare module 'nitropack/types' {
  interface InternalApi {
    '/api/users/:id': {
      get: { id: number; name: string }
    }
    '/api/users': {
      post: { id: number; name: string } | { jobId: string }
    }
    '/api/health': {
      get: { ok: true }
    }
    '/api/payments': {
      post: { id: string }
    }
    '/api/retryable-health': {
      post: { ok: true }
    }
    '/api/search': {
      get: { items: string[] }
    }
    '/api/inferred/:id': {
      get: { id: number; name: string }
    }
  }
}

type Schema<INPUT, OUTPUT = INPUT> = StandardSchemaLike<INPUT, OUTPUT>

const schema = <INPUT, OUTPUT = INPUT>(): Schema<INPUT, OUTPUT> => {
  throw new Error('type-only schema')
}

type Routes =
  | {
      path: '/api/users/:id'
      method: 'get'
      operation: 'getUser'
      definition: {
        operation: 'getUser'
        params: Schema<{ id: string }, { id: number }>
        response: Schema<{ id: number; name: string }>
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
          202: Schema<{ jobId: string }>
          400: Schema<{ message: string }>
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
  | {
      path: '/api/retryable-health'
      method: 'post'
      operation: 'retryableHealth'
      definition: {
        operation: 'retryableHealth'
        idempotency: {
          enabled: true
          headerName: 'X-Request-Key'
          required: false
        }
        response: Schema<{ ok: true }>
      }
    }
  | {
      path: '/api/search'
      method: 'get'
      definition: {
        query: Schema<{ q: string }>
        response: Schema<{ items: string[] }>
      }
    }
  | {
      path: '/api/inferred/:id'
      method: 'get'
      operation: 'getInferredUser'
      definition: {
        operation: 'getInferredUser'
        params: Schema<{ id: string }, { id: number }>
      }
      handlerReturn: { id: number; name: string }
    }
  | {
      path: '/api/inferred-result/:id'
      method: 'get'
      operation: 'getInferredResult'
      definition: {
        operation: 'getInferredResult'
        params: Schema<{ id: string }, { id: number }>
      }
      handlerReturn:
        | { id: number; name: string }
        | StatusResponse<400, { message: string }>
        | StatusResponse<202, { jobId: string }>
    }

type Client = EndpointClient<Routes>

type UseClient = UseEndpointClient<Routes>
type UseResultClient = UseEndpointResultClient<Routes>

type MinimalClient = EndpointClient<
  {
    path: '/api/users/:id'
    method: 'get'
    operation: 'getUser'
    definition: {
      operation: 'getUser'
      params: Schema<{ id: string }, { id: number }>
      response: Schema<{ id: number; name: string }>
    }
  },
  {
    result: false
    raw: false
  }
>

type ReservedAliasClient = EndpointClient<{
  path: '/api/reserved/:id'
  method: 'get'
  operation: 'get'
  definition: {
    operation: 'get'
    params: Schema<{ id: string }, { id: number }>
    response: Schema<{ id: number }>
  }
}>

declare const client: Client
declare const minimalClient: MinimalClient
declare const reservedAliasClient: ReservedAliasClient
declare const useClient: UseClient
declare const useResultClient: UseResultClient

describe('EndpointClient', () => {
  it('requires typed endpoint options when the endpoint declares request schemas', () => {
    client('/api/users/:id', { method: 'get', params: { id: '1' } })
    client('getUser', { params: { id: '1' } })
    client.getUser({ params: { id: '1' } })

    // @ts-expect-error params.id must use the validator input type.
    client('/api/users/:id', { method: 'get', params: { id: 1 } })
    // @ts-expect-error params.id must use the validator input type.
    client('getUser', { params: { id: 1 } })
    // @ts-expect-error params.id must use the validator input type.
    client.getUser({ params: { id: 1 } })
  })

  it('types route paths and methods', () => {
    client('/api/users/:id', { method: 'get', params: { id: '1' } })
    client('/api/search', { method: 'get', query: { q: 'nuxt' } })

    // @ts-expect-error unknown route path.
    client('/api/user/:id', { method: 'get' })
    // @ts-expect-error post is not declared for this path.
    client('/api/users/:id', { method: 'post', params: { id: '1' } })
    // @ts-expect-error path calls require a method.
    client('/api/users/:id', { params: { id: '1' } })
    // @ts-expect-error path-only routes do not generate operation targets.
    client('search', { query: { q: 'nuxt' } })

    reservedAliasClient('/api/reserved/:id', { method: 'get', params: { id: '1' } })
    reservedAliasClient('get', { params: { id: '1' } })
    reservedAliasClient.get({ params: { id: '1' } })
  })

  it('types endpoint responses from success response contracts', () => {
    const getUserByPath = client('/api/users/:id', { method: 'get', params: { id: '1' } })
    const getUserByOperation = client('getUser', { params: { id: '1' } })
    const getUserByAlias = client.getUser({ params: { id: '1' } })
    const createUserByPath = client('/api/users', { method: 'post', body: { name: 'Tom' } })
    const inferredUserByPath = client('/api/inferred/:id', {
      method: 'get',
      params: { id: '1' },
    })
    const inferredUserByOperation = client('getInferredUser', { params: { id: '1' } })

    expectTypeOf<Awaited<typeof getUserByPath>>().toEqualTypeOf<{
      id: number
      name: string
    }>()
    expectTypeOf<Awaited<typeof getUserByOperation>>().toEqualTypeOf<{
      id: number
      name: string
    }>()
    expectTypeOf<Awaited<typeof getUserByAlias>>().toEqualTypeOf<{
      id: number
      name: string
    }>()

    expectTypeOf<Awaited<typeof createUserByPath>>().toEqualTypeOf<
      { id: number; name: string } | { jobId: string }
    >()
    expectTypeOf<Awaited<typeof inferredUserByPath>>().toEqualTypeOf<{
      id: number
      name: string
    }>()
    expectTypeOf<Awaited<typeof inferredUserByOperation>>().toEqualTypeOf<{
      id: number
      name: string
    }>()
  })

  it('types endpoint results by declared status', async () => {
    const userResult = await client('/api/users/:id', {
      method: 'get',
      params: { id: '1' },
    }).result()
    expectTypeOf(userResult).toEqualTypeOf<{
      status: 200
      ok: true
      body: { id: number; name: string }
      headers: Headers
    }>()

    const createResult = await client('/api/users', {
      method: 'post',
      body: { name: 'Tom' },
    }).result()
    if (createResult.status === 201) {
      expectTypeOf(createResult.ok).toEqualTypeOf<true>()
      expectTypeOf(createResult.body).toEqualTypeOf<{ id: number; name: string }>()
    }
    if (createResult.status === 202) {
      expectTypeOf(createResult.ok).toEqualTypeOf<true>()
      expectTypeOf(createResult.body).toEqualTypeOf<{ jobId: string }>()
    }
    if (createResult.status === 400) {
      expectTypeOf(createResult.ok).toEqualTypeOf<false>()
      expectTypeOf(createResult.body).toEqualTypeOf<{ message: string }>()
    }

    const inferredResult = await client('getInferredResult', { params: { id: '1' } }).result()
    if (inferredResult.status === 200) {
      expectTypeOf(inferredResult.ok).toEqualTypeOf<true>()
      expectTypeOf(inferredResult.body).toEqualTypeOf<{ id: number; name: string }>()
    }
    if (inferredResult.status === 202) {
      expectTypeOf(inferredResult.ok).toEqualTypeOf<true>()
      expectTypeOf(inferredResult.body).toEqualTypeOf<{ jobId: string }>()
    }
    if (inferredResult.status === 400) {
      expectTypeOf(inferredResult.ok).toEqualTypeOf<false>()
      expectTypeOf(inferredResult.body).toEqualTypeOf<{ message: string }>()
    }
  })

  it('types raw Web Response values by declared status', async () => {
    const userResponse = await client('/api/users/:id', {
      method: 'get',
      params: { id: '1' },
    }).raw()
    expectTypeOf(userResponse.status).toEqualTypeOf<200>()
    expectTypeOf(userResponse.ok).toEqualTypeOf<true>()
    expectTypeOf(await userResponse.json()).toEqualTypeOf<{ id: number; name: string }>()
    expectTypeOf(userResponse.headers).toEqualTypeOf<Headers>()

    const createResponse = await client('/api/users', {
      method: 'post',
      body: { name: 'Tom' },
    }).raw()
    if (createResponse.status === 201) {
      expectTypeOf(createResponse.ok).toEqualTypeOf<true>()
      expectTypeOf(await createResponse.json()).toEqualTypeOf<{ id: number; name: string }>()
    }
    if (createResponse.status === 202) {
      expectTypeOf(createResponse.ok).toEqualTypeOf<true>()
      expectTypeOf(await createResponse.json()).toEqualTypeOf<{ jobId: string }>()
    }
    if (createResponse.status === 400) {
      expectTypeOf(createResponse.ok).toEqualTypeOf<false>()
      expectTypeOf(await createResponse.json()).toEqualTypeOf<{ message: string }>()
    }

    const inferredResponse = await client('getInferredResult', { params: { id: '1' } }).raw()
    if (inferredResponse.status === 200) {
      expectTypeOf(inferredResponse.ok).toEqualTypeOf<true>()
      expectTypeOf(await inferredResponse.json()).toEqualTypeOf<{ id: number; name: string }>()
    }
    if (inferredResponse.status === 202) {
      expectTypeOf(inferredResponse.ok).toEqualTypeOf<true>()
      expectTypeOf(await inferredResponse.json()).toEqualTypeOf<{ jobId: string }>()
    }
    if (inferredResponse.status === 400) {
      expectTypeOf(inferredResponse.ok).toEqualTypeOf<false>()
      expectTypeOf(await inferredResponse.json()).toEqualTypeOf<{ message: string }>()
    }
  })

  it('does not expose Effect calls by default', () => {
    const call = client('/api/users/:id', { method: 'get', params: { id: '1' } })

    // @ts-expect-error effect is only available when the generated client enables it.
    call.effect()
    // @ts-expect-error resultEffect is not part of the client surface.
    call.resultEffect()
    // @ts-expect-error rawEffect is not part of the client surface.
    call.rawEffect()
  })

  it('hides optional result and raw calls when disabled', () => {
    const call = minimalClient('/api/users/:id', { method: 'get', params: { id: '1' } })
    const operationCall = minimalClient('getUser', { params: { id: '1' } })
    const aliasCall = minimalClient.getUser({ params: { id: '1' } })

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

  it('allows omitted options when the endpoint has no request schema', () => {
    client('/api/health', { method: 'get' })
    client('health')
  })

  it('types required and optional idempotency keys independently of request schemas', () => {
    client('/api/payments', { method: 'post', idempotencyKey: 'request-1' })
    client('createPayment', { idempotencyKey: 'request-1' })
    client.createPayment({ idempotencyKey: 'request-1' })

    // @ts-expect-error idempotencyKey is required by endpoint metadata.
    client('/api/payments', { method: 'post' })
    // @ts-expect-error idempotencyKey is required by endpoint metadata.
    client('createPayment')
    // @ts-expect-error idempotencyKey is required by endpoint metadata.
    client.createPayment()

    client('/api/retryable-health', { method: 'post' })
    client('/api/retryable-health', { method: 'post', idempotencyKey: 'request-1' })
    client('retryableHealth')
    client('retryableHealth', { idempotencyKey: 'request-1' })
    client.retryableHealth()
    client.retryableHealth({ idempotencyKey: 'request-1' })

    useClient('createPayment', { idempotencyKey: 'request-1' })
    // @ts-expect-error idempotencyKey remains required in useEndpoint.
    useClient('createPayment')
    useClient('retryableHealth')
    useClient('retryableHealth', { idempotencyKey: 'request-1' })
  })

  it('types useEndpoint data state from the endpoint response', () => {
    const userState = useClient('/api/users/:id', {
      method: 'get',
      params: { id: '1' },
      key: 'user:1',
      lazy: true,
    })

    expectTypeOf(userState.data.value).toEqualTypeOf<{ id: number; name: string } | undefined>()
    expectTypeOf(userState.pending.value).toEqualTypeOf<boolean>()
    expectTypeOf(userState.refresh()).toEqualTypeOf<Promise<void>>()

    const userOperationState = useClient('getUser', {
      params: { id: '1' },
      lazy: true,
    })
    expectTypeOf(userOperationState.data.value).toEqualTypeOf<
      { id: number; name: string } | undefined
    >()

    // @ts-expect-error useEndpoint does not expose property aliases.
    useClient.getUser({ params: { id: '1' } })

    const transformedState = useClient('/api/users/:id', {
      method: 'get',
      params: { id: '1' },
      transform: (user) => user.name,
    })
    expectTypeOf(transformedState.data.value).toEqualTypeOf<string | undefined>()

    const inferredState = useClient('getInferredUser', {
      params: { id: '1' },
      lazy: true,
    })
    expectTypeOf(inferredState.data.value).toEqualTypeOf<{ id: number; name: string } | undefined>()

    useClient('/api/health', { method: 'get', key: 'health' })
    useClient('health')
    useClient('health', { key: 'health' })

    // @ts-expect-error params.id must use the validator input type.
    useClient('/api/users/:id', { method: 'get', params: { id: 1 } })
    // @ts-expect-error params are required for this endpoint.
    useClient('/api/users/:id', { method: 'get', key: 'missing-params' })
    // @ts-expect-error path calls require a method.
    useClient('/api/users/:id', { params: { id: '1' } })
    // @ts-expect-error operation calls do not take method.
    useClient('getUser', { method: 'get', params: { id: '1' } })
    // @ts-expect-error unknown operation.
    useClient('search', { query: { q: 'nuxt' } })
  })

  it('types useEndpointResult data state by status without Headers', () => {
    const createState = useResultClient('/api/users', {
      method: 'post',
      body: { name: 'Tom' },
      lazy: true,
    })

    const result = createState.data.value
    if (result?.status === 201) {
      expectTypeOf(result.ok).toEqualTypeOf<true>()
      expectTypeOf(result.body).toEqualTypeOf<{ id: number; name: string }>()
    }
    if (result?.status === 202) {
      expectTypeOf(result.ok).toEqualTypeOf<true>()
      expectTypeOf(result.body).toEqualTypeOf<{ jobId: string }>()
    }
    if (result?.status === 400) {
      expectTypeOf(result.ok).toEqualTypeOf<false>()
      expectTypeOf(result.body).toEqualTypeOf<{ message: string }>()
    }

    // @ts-expect-error useEndpointResult keeps results serializable for Nuxt async data.
    void result?.headers

    const operationState = useResultClient('createUser', {
      body: { name: 'Tom' },
    })
    const operationResult = operationState.data.value
    if (operationResult?.status === 201) {
      expectTypeOf(operationResult.body).toEqualTypeOf<{ id: number; name: string }>()
    }

    const inferredState = useResultClient('getInferredResult', {
      params: { id: '1' },
      lazy: true,
    })
    const inferredResult = inferredState.data.value
    if (inferredResult?.status === 200) {
      expectTypeOf(inferredResult.body).toEqualTypeOf<{ id: number; name: string }>()
    }
    if (inferredResult?.status === 202) {
      expectTypeOf(inferredResult.body).toEqualTypeOf<{ jobId: string }>()
    }
    if (inferredResult?.status === 400) {
      expectTypeOf(inferredResult.body).toEqualTypeOf<{ message: string }>()
    }

    // @ts-expect-error operation calls do not take method.
    useResultClient('createUser', { method: 'post', body: { name: 'Tom' } })
  })

  it('keeps request body types strict', () => {
    client('/api/users', { method: 'post', body: { name: 'Tom' } })
    client('createUser', { body: { name: 'Tom' } })

    // @ts-expect-error name is required.
    client('/api/users', { method: 'post', body: {} })
  })

  it('does not need runtime schema values in type tests', () => {
    expectTypeOf(schema<{ id: string }, { id: number }>()).toMatchTypeOf<
      Schema<{ id: string }, { id: number }>
    >()
  })
})
