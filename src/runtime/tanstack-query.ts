import type { ComputedRef } from 'vue'
import { computed } from 'vue'
import type { DataTag, InfiniteData } from '@tanstack/vue-query'
import type {
  EndpointClientRouteConfig,
  EndpointClientRouteConfigInput,
  EndpointFetcherRuntime,
  EndpointOperation,
  EndpointOperationAliasKey,
  EndpointResultData,
  EndpointRouteEntry,
  RouteResponseBody,
} from './client'
import {
  createEndpointRequest,
  isReservedEndpointOperationAlias,
  normalizeEndpointRequestKey,
  normalizeRoutes,
} from './client'
import type { EndpointClientOptions, EndpointClientOptionsAreOptional } from './contract'

export type { EndpointFetcherRuntime } from './client'

const queryNamespace = 'nuxt-endpoints'
const queryVersion = 'v1'

type EndpointQueryMode = 'data' | 'result'

// Single source for the runtime classification below, the compile-time
// query/mutation operation unions, and the build-time unclassified-method
// warning in module.ts, so all three agree on which HTTP methods are queries
// and which are mutations.
export const queryHttpMethodList = ['get', 'head'] as const
export const mutationHttpMethodList = ['delete', 'patch', 'post', 'put'] as const

const queryHttpMethods = new Set<string>(queryHttpMethodList)
const mutationHttpMethods = new Set<string>(mutationHttpMethodList)

export type EndpointQueryKey = readonly unknown[]

export type EndpointKeyScope =
  | string
  | number
  | boolean
  | null
  | readonly unknown[]
  | Record<string, unknown>

type EndpointQueryHttpMethod = (typeof queryHttpMethodList)[number]
type EndpointMutationHttpMethod = (typeof mutationHttpMethodList)[number]

export type EndpointQueryOperation<ROUTES extends EndpointRouteEntry> = EndpointOperation<
  Extract<ROUTES, { method: EndpointQueryHttpMethod }>
>
export type EndpointMutationOperation<ROUTES extends EndpointRouteEntry> = EndpointOperation<
  Extract<ROUTES, { method: EndpointMutationHttpMethod }>
>

type EndpointQueryScopeOptions = { keyScope?: EndpointKeyScope }

export type EndpointQueryRequest<ROUTE extends EndpointRouteEntry> =
  EndpointClientOptions<ROUTE['definition']> extends void
    ? EndpointQueryScopeOptions
    : EndpointClientOptions<ROUTE['definition']> & EndpointQueryScopeOptions

export type EndpointQueryRequestInput<ROUTE extends EndpointRouteEntry> =
  | EndpointQueryRequest<ROUTE>
  | (() => EndpointQueryRequest<ROUTE>)

export type EndpointQueryRequestArgs<ROUTE extends EndpointRouteEntry> =
  EndpointClientOptionsAreOptional<ROUTE['definition']> extends true
    ? [request?: EndpointQueryRequestInput<ROUTE>]
    : [request: EndpointQueryRequestInput<ROUTE>]

export type EndpointQueryKeyArgs<ROUTE extends EndpointRouteEntry> = [
  request?: EndpointQueryRequest<ROUTE>,
]

export type EndpointQueryKeyInput = EndpointQueryKey | ComputedRef<EndpointQueryKey>

// `DataTag` brands a query key with the data type it resolves to, so
// `queryClient.getQueryData(factory.key(request))` infers the cached value's
// type instead of `unknown`. It is a phantom (type-only) intersection - the
// underlying array is identical to `EndpointQueryKey` at runtime.
export type EndpointTaggedQueryKey<DATA> = DataTag<EndpointQueryKey, DATA>

export type EndpointQueryFunctionContext = { signal: AbortSignal; queryKey: EndpointQueryKey }

export type EndpointQueryOptionsObject<DATA> = {
  queryKey: EndpointTaggedQueryKey<DATA> | ComputedRef<EndpointTaggedQueryKey<DATA>>
  queryFn: (context: EndpointQueryFunctionContext) => Promise<DATA>
}

export type EndpointQueryOptionsFactory<ROUTE extends EndpointRouteEntry> = {
  (...args: EndpointQueryRequestArgs<ROUTE>): EndpointQueryOptionsObject<RouteResponseBody<ROUTE>>
  result: {
    (
      ...args: EndpointQueryRequestArgs<ROUTE>
    ): EndpointQueryOptionsObject<EndpointResultData<ROUTE>>
    key: {
      (): EndpointQueryKey
      (request: EndpointQueryRequest<ROUTE>): EndpointTaggedQueryKey<EndpointResultData<ROUTE>>
    }
  }
  key: {
    (): EndpointQueryKey
    (request: EndpointQueryRequest<ROUTE>): EndpointTaggedQueryKey<RouteResponseBody<ROUTE>>
  }
}

export type EndpointQueryOptionsClient<ROUTES extends EndpointRouteEntry> = {
  [OPERATION in EndpointQueryOperation<ROUTES> as EndpointOperationAliasKey<OPERATION>]: EndpointQueryOptionsFactory<
    Extract<ROUTES, { operation: OPERATION }>
  >
}

export type EndpointInfiniteQueryPageParam = unknown

export type EndpointInfiniteQueryRequest<ROUTE extends EndpointRouteEntry> =
  EndpointClientOptionsAreOptional<ROUTE['definition']> extends true
    ? EndpointClientOptions<ROUTE['definition']> extends void
      ? Record<string, never> | undefined | void
      : EndpointClientOptions<ROUTE['definition']> | undefined | void
    : EndpointClientOptions<ROUTE['definition']>

export type EndpointInfiniteQueryConfig<ROUTE extends EndpointRouteEntry, PAGE_PARAM, PAGE> = {
  initialPageParam: PAGE_PARAM
  request: (pageParam: PAGE_PARAM) => EndpointInfiniteQueryRequest<ROUTE>
  getNextPageParam: (
    lastPage: PAGE,
    allPages: PAGE[],
    lastPageParam: PAGE_PARAM,
    allPageParams: PAGE_PARAM[],
  ) => PAGE_PARAM | undefined | null
  getPreviousPageParam?: (
    firstPage: PAGE,
    allPages: PAGE[],
    firstPageParam: PAGE_PARAM,
    allPageParams: PAGE_PARAM[],
  ) => PAGE_PARAM | undefined | null
  keyScope?: EndpointKeyScope
}

export type EndpointInfiniteQueryFunctionContext<PAGE_PARAM> = {
  signal: AbortSignal
  pageParam: PAGE_PARAM
}

export type EndpointInfiniteQueryOptionsObject<PAGE, PAGE_PARAM> = {
  queryKey: EndpointTaggedQueryKey<InfiniteData<PAGE, PAGE_PARAM>>
  queryFn: (context: EndpointInfiniteQueryFunctionContext<PAGE_PARAM>) => Promise<PAGE>
  initialPageParam: PAGE_PARAM
  getNextPageParam: (
    lastPage: PAGE,
    allPages: PAGE[],
    lastPageParam: PAGE_PARAM,
    allPageParams: PAGE_PARAM[],
  ) => PAGE_PARAM | undefined | null
  getPreviousPageParam?: (
    firstPage: PAGE,
    allPages: PAGE[],
    firstPageParam: PAGE_PARAM,
    allPageParams: PAGE_PARAM[],
  ) => PAGE_PARAM | undefined | null
}

export type EndpointInfiniteQueryOptionsFactory<ROUTE extends EndpointRouteEntry> = {
  <PAGE_PARAM>(
    config: EndpointInfiniteQueryConfig<ROUTE, PAGE_PARAM, RouteResponseBody<ROUTE>>,
  ): EndpointInfiniteQueryOptionsObject<RouteResponseBody<ROUTE>, PAGE_PARAM>
  result: {
    <PAGE_PARAM>(
      config: EndpointInfiniteQueryConfig<ROUTE, PAGE_PARAM, EndpointResultData<ROUTE>>,
    ): EndpointInfiniteQueryOptionsObject<EndpointResultData<ROUTE>, PAGE_PARAM>
    key: {
      (): EndpointQueryKey
      <PAGE_PARAM>(
        config: EndpointInfiniteQueryConfig<ROUTE, PAGE_PARAM, EndpointResultData<ROUTE>>,
      ): EndpointTaggedQueryKey<InfiniteData<EndpointResultData<ROUTE>, PAGE_PARAM>>
    }
  }
  key: {
    (): EndpointQueryKey
    <PAGE_PARAM>(
      config: EndpointInfiniteQueryConfig<ROUTE, PAGE_PARAM, RouteResponseBody<ROUTE>>,
    ): EndpointTaggedQueryKey<InfiniteData<RouteResponseBody<ROUTE>, PAGE_PARAM>>
  }
}

export type EndpointInfiniteQueryOptionsClient<ROUTES extends EndpointRouteEntry> = {
  [OPERATION in EndpointQueryOperation<ROUTES> as EndpointOperationAliasKey<OPERATION>]: EndpointInfiniteQueryOptionsFactory<
    Extract<ROUTES, { operation: OPERATION }>
  >
}

export type EndpointMutationVariables<ROUTE extends EndpointRouteEntry> =
  EndpointClientOptionsAreOptional<ROUTE['definition']> extends true
    ? EndpointClientOptions<ROUTE['definition']> extends void
      ? void
      : EndpointClientOptions<ROUTE['definition']> | void
    : EndpointClientOptions<ROUTE['definition']>

export type EndpointMutationOptionsObject<DATA, VARIABLES> = {
  mutationKey: EndpointQueryKey
  mutationFn: (variables: VARIABLES) => Promise<DATA>
}

export type EndpointMutationOptionsFactory<ROUTE extends EndpointRouteEntry> = {
  (): EndpointMutationOptionsObject<RouteResponseBody<ROUTE>, EndpointMutationVariables<ROUTE>>
  result: () => EndpointMutationOptionsObject<
    EndpointResultData<ROUTE>,
    EndpointMutationVariables<ROUTE>
  >
  key: () => EndpointQueryKey
}

export type EndpointMutationOptionsClient<ROUTES extends EndpointRouteEntry> = {
  [OPERATION in EndpointMutationOperation<ROUTES> as EndpointOperationAliasKey<OPERATION>]: EndpointMutationOptionsFactory<
    Extract<ROUTES, { operation: OPERATION }>
  >
}

export type EndpointQueryClientRuntimeOptions = {
  fetcher?: EndpointFetcherRuntime
  captureFetcher?: () => EndpointFetcherRuntime | undefined
}

export function createEndpointQueryOptions(
  routesInput: EndpointClientRouteConfigInput,
  options: EndpointQueryClientRuntimeOptions = {},
): Record<string, unknown> {
  const routes = normalizeRoutes(routesInput)
  const client: Record<string, unknown> = {}

  for (const route of routes) {
    if (!route.operation || isReservedEndpointOperationAlias(route.operation)) {
      continue
    }
    if (!queryHttpMethods.has(route.method)) {
      continue
    }

    client[route.operation] = createQueryOptionsFactory(route, options)
  }

  return client
}

export function createEndpointMutationOptions(
  routesInput: EndpointClientRouteConfigInput,
  options: EndpointQueryClientRuntimeOptions = {},
): Record<string, unknown> {
  const routes = normalizeRoutes(routesInput)
  const client: Record<string, unknown> = {}

  for (const route of routes) {
    if (!route.operation || isReservedEndpointOperationAlias(route.operation)) {
      continue
    }
    if (!mutationHttpMethods.has(route.method)) {
      continue
    }

    client[route.operation] = createMutationOptionsFactory(route, options)
  }

  return client
}

export function createEndpointInfiniteQueryOptions(
  routesInput: EndpointClientRouteConfigInput,
  options: EndpointQueryClientRuntimeOptions = {},
): Record<string, unknown> {
  const routes = normalizeRoutes(routesInput)
  const client: Record<string, unknown> = {}

  for (const route of routes) {
    if (!route.operation || isReservedEndpointOperationAlias(route.operation)) {
      continue
    }
    if (!queryHttpMethods.has(route.method)) {
      continue
    }

    client[route.operation] = createInfiniteQueryOptionsFactory(route, options)
  }

  return client
}

function createQueryOptionsFactory(
  route: EndpointClientRouteConfig,
  clientOptions: EndpointQueryClientRuntimeOptions,
) {
  const factory = ((input?: unknown) =>
    buildQueryOptionsObject(route, input, 'data', clientOptions)) as {
    (input?: unknown): EndpointQueryOptionsObject<unknown>
    result: {
      (input?: unknown): EndpointQueryOptionsObject<unknown>
      key: (input?: unknown) => EndpointQueryKey
    }
    key: (input?: unknown) => EndpointQueryKey
  }

  const result = ((input?: unknown) =>
    buildQueryOptionsObject(route, input, 'result', clientOptions)) as {
    (input?: unknown): EndpointQueryOptionsObject<unknown>
    key: (input?: unknown) => EndpointQueryKey
  }
  result.key = (input?: unknown) => buildKeyArg(route, 'result', input)

  factory.result = result
  factory.key = (input?: unknown) => buildKeyArg(route, 'data', input)

  return factory
}

function createMutationOptionsFactory(
  route: EndpointClientRouteConfig,
  clientOptions: EndpointQueryClientRuntimeOptions,
) {
  const factory = (() => buildMutationOptionsObject(route, 'data', clientOptions)) as {
    (): EndpointMutationOptionsObject<unknown, unknown>
    result: () => EndpointMutationOptionsObject<unknown, unknown>
    key: () => EndpointQueryKey
  }

  factory.result = () => buildMutationOptionsObject(route, 'result', clientOptions)
  factory.key = () => requestKeyPrefix(route.operation as string, 'data')

  return factory
}

function createInfiniteQueryOptionsFactory(
  route: EndpointClientRouteConfig,
  clientOptions: EndpointQueryClientRuntimeOptions,
) {
  const factory = ((config: Record<string, unknown>) =>
    buildInfiniteQueryOptionsObject(route, config, 'data', clientOptions)) as {
    (config: Record<string, unknown>): EndpointInfiniteQueryOptionsObject<unknown, unknown>
    result: {
      (config: Record<string, unknown>): EndpointInfiniteQueryOptionsObject<unknown, unknown>
      key: (config?: Record<string, unknown>) => EndpointQueryKey
    }
    key: (config?: Record<string, unknown>) => EndpointQueryKey
  }

  const result = ((config: Record<string, unknown>) =>
    buildInfiniteQueryOptionsObject(route, config, 'result', clientOptions)) as {
    (config: Record<string, unknown>): EndpointInfiniteQueryOptionsObject<unknown, unknown>
    key: (config?: Record<string, unknown>) => EndpointQueryKey
  }
  result.key = (config?: Record<string, unknown>) => buildInfiniteKeyArg(route, 'result', config)

  factory.result = result
  factory.key = (config?: Record<string, unknown>) => buildInfiniteKeyArg(route, 'data', config)

  return factory
}

function buildQueryOptionsObject(
  route: EndpointClientRouteConfig,
  input: unknown,
  mode: EndpointQueryMode,
  clientOptions: EndpointQueryClientRuntimeOptions,
): EndpointQueryOptionsObject<unknown> {
  const fetcher = clientOptions.fetcher ?? clientOptions.captureFetcher?.()
  const isGetter = typeof input === 'function'
  const resolveInput = () => (isGetter ? (input as () => unknown)() : input)

  const queryKey: EndpointQueryKeyInput = isGetter
    ? computed(() => createFullKey(route, mode, resolveInput()))
    : createFullKey(route, mode, input)

  const queryFn = (context: EndpointQueryFunctionContext) => {
    // Getter input: derive params/query/body from the queryKey TanStack just
    // passed in, not from re-invoking the getter. The key already carries the
    // request segment that produced it, so key and request stay atomically
    // paired even if the getter's underlying ref has since moved on (see the
    // "race-elimination guarantee" tests in test/query.test.ts). Only headers
    // are read live from the getter, because headers are deliberately excluded
    // from cache identity - "current headers" is the correct semantic there.
    const requestOptions = isGetter
      ? (() => {
          const segment = readRequestSegmentFromKey(context.queryKey, mode)
          const current = (resolveInput() ?? {}) as Record<string, unknown>
          const headers = current.headers
          return { ...segment, ...(headers !== undefined ? { headers } : {}) }
        })()
      : (() => {
          const { keyScope: _keyScope, ...rest } = (resolveInput() ?? {}) as Record<string, unknown>
          return rest
        })()

    const request = createEndpointRequest(route, requestOptions, { fetcher })

    if (mode === 'result') {
      return request.result(context.signal).then((result) => ({
        status: result.status,
        ok: result.ok,
        body: result.body,
      }))
    }

    return request.data(context.signal)
  }

  return { queryKey, queryFn } as unknown as EndpointQueryOptionsObject<unknown>
}

function readRequestSegmentFromKey(
  key: EndpointQueryKey,
  mode: EndpointQueryMode,
): Record<string, unknown> {
  // The request segment sits immediately after the prefix createFullKey wrote,
  // so its position is that prefix's length — no index that could drift from
  // the layout. The operation value does not affect the prefix length.
  const segment = key[requestKeyPrefix('', mode).length]
  return (segment ?? {}) as Record<string, unknown>
}

function buildMutationOptionsObject(
  route: EndpointClientRouteConfig,
  mode: EndpointQueryMode,
  clientOptions: EndpointQueryClientRuntimeOptions,
): EndpointMutationOptionsObject<unknown, unknown> {
  const fetcher = clientOptions.fetcher ?? clientOptions.captureFetcher?.()
  const operation = route.operation as string
  const mutationKey: EndpointQueryKey = requestKeyPrefix(operation, mode)

  const mutationFn = (variables: unknown) => {
    const requestOptions = (variables as Record<string, unknown>) ?? {}
    const request = createEndpointRequest(route, requestOptions, { fetcher })

    if (mode === 'result') {
      return request.result().then((result) => ({
        status: result.status,
        ok: result.ok,
        body: result.body,
      }))
    }

    return request.data()
  }

  return { mutationKey, mutationFn }
}

function buildInfiniteQueryOptionsObject(
  route: EndpointClientRouteConfig,
  config: Record<string, unknown>,
  mode: EndpointQueryMode,
  clientOptions: EndpointQueryClientRuntimeOptions,
): EndpointInfiniteQueryOptionsObject<unknown, unknown> {
  const fetcher = clientOptions.fetcher ?? clientOptions.captureFetcher?.()
  const requestFactory = config.request as (pageParam: unknown) => unknown

  const queryFn = (context: EndpointInfiniteQueryFunctionContext<unknown>) => {
    const requestOptions = (requestFactory(context.pageParam) ?? {}) as Record<string, unknown>
    const request = createEndpointRequest(route, requestOptions, { fetcher })

    if (mode === 'result') {
      return request.result(context.signal).then((result) => ({
        status: result.status,
        ok: result.ok,
        body: result.body,
      }))
    }

    return request.data(context.signal)
  }

  return {
    queryKey: createInfiniteFullKey(route, mode, config),
    queryFn,
    initialPageParam: config.initialPageParam,
    getNextPageParam: config.getNextPageParam as EndpointInfiniteQueryOptionsObject<
      unknown,
      unknown
    >['getNextPageParam'],
    ...(config.getPreviousPageParam !== undefined
      ? { getPreviousPageParam: config.getPreviousPageParam }
      : {}),
  } as unknown as EndpointInfiniteQueryOptionsObject<unknown, unknown>
}

function buildKeyArg(
  route: EndpointClientRouteConfig,
  mode: EndpointQueryMode,
  input: unknown,
): EndpointQueryKey {
  if (input === undefined) {
    return requestKeyPrefix(route.operation as string, mode)
  }

  return createFullKey(route, mode, input)
}

function createFullKey(
  route: EndpointClientRouteConfig,
  mode: EndpointQueryMode,
  input: unknown,
): EndpointQueryKey {
  const record = (input ?? {}) as Record<string, unknown>
  const segment = requestSegment(record)
  const base = [...requestKeyPrefix(route.operation as string, mode), segment]

  return record.keyScope !== undefined ? [...base, record.keyScope] : base
}

function buildInfiniteKeyArg(
  route: EndpointClientRouteConfig,
  mode: EndpointQueryMode,
  config: Record<string, unknown> | undefined,
): EndpointQueryKey {
  if (config === undefined) {
    return infiniteKeyPrefix(route.operation as string, mode)
  }

  return createInfiniteFullKey(route, mode, config)
}

function createInfiniteFullKey(
  route: EndpointClientRouteConfig,
  mode: EndpointQueryMode,
  config: Record<string, unknown>,
): EndpointQueryKey {
  const requestFactory = config.request as (pageParam: unknown) => unknown
  const initialRequest = (requestFactory(config.initialPageParam) ?? {}) as Record<string, unknown>
  const segment = requestSegment(initialRequest)
  const base = [...infiniteKeyPrefix(route.operation as string, mode), segment]

  return config.keyScope !== undefined ? [...base, config.keyScope] : base
}

// Key layout shared by every non-infinite query and mutation key:
//   [namespace, version, operation]            in data mode
//   [namespace, version, operation, 'result']  in result mode
// A request segment, when present, is written immediately after this prefix, so
// the reader locates it from the prefix length rather than a hard-coded index.
function requestKeyPrefix(operation: string, mode: EndpointQueryMode): unknown[] {
  return mode === 'result'
    ? [queryNamespace, queryVersion, operation, 'result']
    : [queryNamespace, queryVersion, operation]
}

// Infinite keys insert an 'infinite' marker before the optional result marker.
function infiniteKeyPrefix(operation: string, mode: EndpointQueryMode): unknown[] {
  return mode === 'result'
    ? [queryNamespace, queryVersion, operation, 'infinite', 'result']
    : [queryNamespace, queryVersion, operation, 'infinite']
}

function requestSegment(record: Record<string, unknown>): unknown {
  const picked: Record<string, unknown> = {}

  if (record.params !== undefined) {
    picked.params = record.params
  }
  if (record.query !== undefined) {
    picked.query = record.query
  }
  if (record.body !== undefined) {
    picked.body = record.body
  }
  if (record.mediaType !== undefined) {
    picked.mediaType = record.mediaType
  }
  // `accept` selects which representation the server sends, so two calls that
  // differ only in it are different cached values, not the same one.
  if (record.accept !== undefined) {
    picked.accept = record.accept
  }
  if (record.idempotencyKey !== undefined) {
    picked.idempotencyKey = record.idempotencyKey
  }

  return normalizeEndpointRequestKey(picked)
}
