import type {
  EndpointClientOptions,
  EndpointClientOptionsAreOptional,
  EndpointDefinition,
  EndpointResponsesContract,
  EndpointMediaResponseStream,
  EndpointSuccessBody,
  HasEndpointResponses,
  HasMediaResponseContract,
  HttpMethod,
  IsSuccessStatus,
  NormalizeResponses,
  ResponseBody,
  StatusNumber,
  UnknownIfNever,
} from './contract'
import { hasHttpControlCharacter } from './idempotency'
import { replacePathParams } from './path-template'
import type { StatusResponse } from './response'
import type { EndpointWireValue } from './wire'

export type EndpointRouteEntry = {
  path: string
  method: HttpMethod
  operation?: string
  definition: EndpointDefinition
  handlerReturn?: unknown
}

export type EndpointClientFeatureOptions = {
  result: boolean
  raw: boolean
}

export type DefaultEndpointClientFeatures = {
  result: true
  raw: true
}

export type EndpointClient<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = EndpointPathCaller<ROUTES, FEATURES> &
  EndpointOperationCaller<ROUTES, FEATURES> &
  EndpointOperationAliases<ROUTES, FEATURES>

export type UseEndpointClient<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = UseEndpointCaller<ROUTES, FEATURES>

export type UseEndpointResultClient<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = FEATURES['result'] extends true ? UseEndpointResultCaller<ROUTES, FEATURES> : never

export type EndpointPathCaller<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = <
  const PATH extends EndpointPath<ROUTES>,
  const METHOD extends EndpointRouteMethod<ROUTES, PATH>,
  ROUTE extends Extract<ROUTES, { path: PATH; method: METHOD }>,
>(
  path: PATH,
  options: EndpointPathClientOptions<ROUTE, METHOD>,
) => EndpointCall<ROUTE, FEATURES>

export type EndpointOperationCaller<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = <
  const OPERATION extends EndpointOperation<ROUTES>,
  ROUTE extends Extract<ROUTES, { operation: OPERATION }>,
>(
  ...args: EndpointOperationCallArgs<OPERATION, ROUTE>
) => EndpointCall<ROUTE, FEATURES>

export type EndpointOperationAliases<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = {
  [OPERATION in EndpointOperation<ROUTES> as EndpointOperationAliasKey<OPERATION>]: (
    ...args: EndpointOperationAliasCallArgs<Extract<ROUTES, { operation: OPERATION }>>
  ) => EndpointCall<Extract<ROUTES, { operation: OPERATION }>, FEATURES>
}

export type UseEndpointCaller<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = UseEndpointPathCaller<ROUTES, FEATURES> & UseEndpointOperationCaller<ROUTES, FEATURES>

export type UseEndpointPathCaller<
  ROUTES extends EndpointRouteEntry,
  _FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = <
  const PATH extends EndpointPath<ROUTES>,
  const METHOD extends EndpointRouteMethod<ROUTES, PATH>,
  ROUTE extends Extract<ROUTES, { path: PATH; method: METHOD }>,
  DATA = RouteResponseBody<ROUTE>,
  DEFAULT = undefined,
>(
  path: PATH,
  options: UseEndpointClientOptions<ROUTE, RouteResponseBody<ROUTE>, DATA, DEFAULT> & {
    method: METHOD
  },
) => EndpointAsyncData<DATA | DEFAULT>

export type UseEndpointResultCaller<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = UseEndpointResultPathCaller<ROUTES, FEATURES> &
  UseEndpointResultOperationCaller<ROUTES, FEATURES>

export type UseEndpointOperationCaller<
  ROUTES extends EndpointRouteEntry,
  _FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = <
  const OPERATION extends EndpointOperation<ROUTES>,
  ROUTE extends Extract<ROUTES, { operation: OPERATION }>,
  DATA = RouteResponseBody<ROUTE>,
  DEFAULT = undefined,
>(
  ...args: UseEndpointOperationArgs<OPERATION, ROUTE, RouteResponseBody<ROUTE>, DATA, DEFAULT>
) => EndpointAsyncData<DATA | DEFAULT>

export type UseEndpointResultPathCaller<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = <
  const PATH extends EndpointPath<ROUTES>,
  const METHOD extends EndpointRouteMethod<ROUTES, PATH>,
  ROUTE extends Extract<ROUTES, { path: PATH; method: METHOD }>,
  DATA = EndpointResultData<ROUTE>,
  DEFAULT = undefined,
>(
  path: PATH,
  options: UseEndpointResultClientOptions<ROUTE, FEATURES, DATA, DEFAULT> & {
    method: METHOD
  },
) => EndpointAsyncData<DATA | DEFAULT>

export type UseEndpointResultOperationCaller<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = <
  const OPERATION extends EndpointOperation<ROUTES>,
  ROUTE extends Extract<ROUTES, { operation: OPERATION }>,
  DATA = EndpointResultData<ROUTE>,
  DEFAULT = undefined,
>(
  ...args: UseEndpointResultOperationArgs<OPERATION, ROUTE, FEATURES, DATA, DEFAULT>
) => EndpointAsyncData<DATA | DEFAULT>

export type EndpointPath<ROUTES extends EndpointRouteEntry> = ROUTES['path']

export type EndpointOperation<ROUTES extends EndpointRouteEntry> = ROUTES extends {
  operation: infer OPERATION extends string
}
  ? OPERATION extends `/${string}`
    ? never
    : OPERATION
  : never

export type EndpointRouteMethod<
  ROUTES extends EndpointRouteEntry,
  PATH extends EndpointPath<ROUTES>,
> = Extract<ROUTES, { path: PATH }>['method']

export type EndpointPathCall<
  ROUTES extends EndpointRouteEntry,
  PATH extends EndpointPath<ROUTES>,
  METHOD extends EndpointRouteMethod<ROUTES, PATH>,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = EndpointCall<Extract<ROUTES, { path: PATH; method: METHOD }>, FEATURES>

export type EndpointOperationCall<
  ROUTES extends EndpointRouteEntry,
  OPERATION extends EndpointOperation<ROUTES>,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = EndpointCall<Extract<ROUTES, { operation: OPERATION }>, FEATURES>

export type EndpointPathClientOptions<
  ROUTE extends EndpointRouteEntry,
  METHOD extends ROUTE['method'],
> =
  EndpointClientOptions<ROUTE['definition']> extends void
    ? { method: METHOD }
    : EndpointClientOptions<ROUTE['definition']> & { method: METHOD }

export type EndpointOperationCallArgs<OPERATION extends string, ROUTE extends EndpointRouteEntry> =
  EndpointClientOptionsAreOptional<ROUTE['definition']> extends true
    ? [
        operation: OPERATION,
        options?: EndpointClientOptions<ROUTE['definition']> extends void
          ? undefined
          : EndpointClientOptions<ROUTE['definition']>,
      ]
    : [operation: OPERATION, options: EndpointClientOptions<ROUTE['definition']>]

export type EndpointOperationAliasCallArgs<ROUTE extends EndpointRouteEntry> =
  EndpointClientOptionsAreOptional<ROUTE['definition']> extends true
    ? [
        options?: EndpointClientOptions<ROUTE['definition']> extends void
          ? undefined
          : EndpointClientOptions<ROUTE['definition']>,
      ]
    : [options: EndpointClientOptions<ROUTE['definition']>]

export type EndpointOperationRequestOptions<
  ROUTES extends EndpointRouteEntry,
  OPERATION extends EndpointOperation<ROUTES>,
> = EndpointClientOptions<Extract<ROUTES, { operation: OPERATION }>['definition']>

export type EndpointOperationAliasKey<OPERATION extends string> =
  OPERATION extends EndpointOperationAliasReservedKey ? never : OPERATION

type EndpointOperationAliasReservedKey = (typeof reservedEndpointOperationAliasList)[number]

export type UseEndpointClientMethod<
  ROUTE extends EndpointRouteEntry,
  _FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = <DATA = RouteResponseBody<ROUTE>, DEFAULT = undefined>(
  path: ROUTE['path'],
  options: UseEndpointClientOptions<ROUTE, RouteResponseBody<ROUTE>, DATA, DEFAULT> & {
    method: ROUTE['method']
  },
) => EndpointAsyncData<DATA | DEFAULT>

export type UseEndpointClientOptions<
  ROUTE extends EndpointRouteEntry,
  RESULT,
  DATA = RESULT,
  DEFAULT = undefined,
> =
  EndpointClientOptions<ROUTE['definition']> extends void
    ? UseEndpointOptions<RESULT, DATA, DEFAULT>
    : EndpointClientOptions<ROUTE['definition']> & UseEndpointOptions<RESULT, DATA, DEFAULT>

export type UseEndpointOperationArgs<
  OPERATION extends string,
  ROUTE extends EndpointRouteEntry,
  RESULT,
  DATA = RESULT,
  DEFAULT = undefined,
> =
  EndpointClientOptionsAreOptional<ROUTE['definition']> extends true
    ? [operation: OPERATION, options?: UseEndpointClientOptions<ROUTE, RESULT, DATA, DEFAULT>]
    : [operation: OPERATION, options: UseEndpointClientOptions<ROUTE, RESULT, DATA, DEFAULT>]

export type UseEndpointResultClientMethod<
  ROUTE extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = FEATURES['result'] extends true
  ? <DATA = EndpointResultData<ROUTE>, DEFAULT = undefined>(
      path: ROUTE['path'],
      options: UseEndpointResultClientOptions<ROUTE, FEATURES, DATA, DEFAULT> & {
        method: ROUTE['method']
      },
    ) => EndpointAsyncData<DATA | DEFAULT>
  : never

export type UseEndpointResultClientOptions<
  ROUTE extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
  DATA = EndpointResultData<ROUTE>,
  DEFAULT = undefined,
> = FEATURES['result'] extends true
  ? UseEndpointClientOptions<ROUTE, EndpointResultData<ROUTE>, DATA, DEFAULT>
  : never

export type UseEndpointResultOperationArgs<
  OPERATION extends string,
  ROUTE extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
  DATA = EndpointResultData<ROUTE>,
  DEFAULT = undefined,
> =
  EndpointClientOptionsAreOptional<ROUTE['definition']> extends true
    ? [
        operation: OPERATION,
        options?: UseEndpointResultClientOptions<ROUTE, FEATURES, DATA, DEFAULT>,
      ]
    : [
        operation: OPERATION,
        options: UseEndpointResultClientOptions<ROUTE, FEATURES, DATA, DEFAULT>,
      ]

export type EndpointCall<
  ROUTE extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = PromiseLike<RouteResponseBody<ROUTE>> &
  Pick<Promise<RouteResponseBody<ROUTE>>, 'catch' | 'finally'> &
  EndpointResultCallFeature<ROUTE, FEATURES> &
  EndpointRawCallFeature<ROUTE, FEATURES>

type EndpointResultCallFeature<
  ROUTE extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions,
> = FEATURES['result'] extends true
  ? {
      result: () => Promise<EndpointResult<ROUTE>>
    }
  : {}

type EndpointRawCallFeature<
  ROUTE extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions,
> = FEATURES['raw'] extends true
  ? {
      raw: () => Promise<EndpointRawResponse<ROUTE>>
    }
  : {}

export type EndpointResult<ROUTE extends EndpointRouteEntry> =
  HasEndpointResponses<ROUTE['definition']> extends true
    ? EndpointResultValue<NormalizeResponses<ROUTE['definition']>>
    : InferredEndpointResultValue<RouteHandlerReturn<ROUTE>>

export type EndpointResultData<ROUTE extends EndpointRouteEntry> =
  HasEndpointResponses<ROUTE['definition']> extends true
    ? EndpointResultDataValue<NormalizeResponses<ROUTE['definition']>>
    : InferredEndpointResultDataValue<RouteHandlerReturn<ROUTE>>

export type EndpointRawResponse<ROUTE extends EndpointRouteEntry> =
  HasEndpointResponses<ROUTE['definition']> extends true
    ? EndpointRawResponseValue<NormalizeResponses<ROUTE['definition']>>
    : InferredEndpointRawResponseValue<RouteHandlerReturn<ROUTE>>

export type EndpointResultValue<RESPONSES extends EndpointResponsesContract> = [
  keyof RESPONSES,
] extends [never]
  ? {
      status: number
      ok: boolean
      body: unknown
      headers: Headers
    }
  : {
      [STATUS in keyof RESPONSES]: StatusNumber<STATUS> extends infer STATUS_NUMBER extends number
        ? {
            status: STATUS_NUMBER
            ok: IsSuccessStatus<STATUS_NUMBER>
            body: EndpointClientBody<RESPONSES, STATUS>
            headers: Headers
          }
        : never
    }[keyof RESPONSES]

export type EndpointResultDataValue<RESPONSES extends EndpointResponsesContract> = [
  keyof RESPONSES,
] extends [never]
  ? {
      status: number
      ok: boolean
      body: unknown
    }
  : {
      [STATUS in keyof RESPONSES]: StatusNumber<STATUS> extends infer STATUS_NUMBER extends number
        ? {
            status: STATUS_NUMBER
            ok: IsSuccessStatus<STATUS_NUMBER>
            body: EndpointClientBody<RESPONSES, STATUS>
          }
        : never
    }[keyof RESPONSES]

export type EndpointRawResponseValue<RESPONSES extends EndpointResponsesContract> = [
  keyof RESPONSES,
] extends [never]
  ? TypedRawResponse<number, boolean, unknown>
  : {
      [STATUS in keyof RESPONSES]: StatusNumber<STATUS> extends infer STATUS_NUMBER extends number
        ? TypedRawResponse<
            STATUS_NUMBER,
            IsSuccessStatus<STATUS_NUMBER>,
            EndpointClientBody<RESPONSES, STATUS>
          >
        : never
    }[keyof RESPONSES]

export type TypedRawResponse<STATUS extends number, OK extends boolean, BODY> = Omit<
  Response,
  'json' | 'ok' | 'status'
> & {
  status: STATUS
  ok: OK
  json: () => Promise<BODY>
}

/**
 * The body type for one declared status. A route with any media response is
 * unparsed end to end - `createEndpointRequest` tells the fetcher not to read
 * it - so every status arrives as the live stream, including the JSON error
 * shapes the contract still documents for OpenAPI.
 */
type EndpointClientBody<
  RESPONSES extends EndpointResponsesContract,
  STATUS extends keyof RESPONSES,
> =
  HasMediaResponseContract<RESPONSES> extends true
    ? EndpointMediaResponseStream
    : EndpointWireValue<ResponseBody<RESPONSES[STATUS]>>

export type RouteResponseBody<ROUTE extends EndpointRouteEntry> =
  HasEndpointResponses<ROUTE['definition']> extends true
    ? HasMediaResponseContract<NormalizeResponses<ROUTE['definition']>> extends true
      ? EndpointMediaResponseStream
      : EndpointWireValue<EndpointSuccessBody<ROUTE['definition']>>
    : InferredHandlerSuccessBody<RouteHandlerReturn<ROUTE>>

type RouteHandlerReturn<ROUTE extends EndpointRouteEntry> = ROUTE extends {
  handlerReturn: infer HANDLER_RETURN
}
  ? HANDLER_RETURN
  : unknown

type AwaitedHandlerReturn<HANDLER_RETURN> = Awaited<HANDLER_RETURN>

type InferredHandlerSuccessBody<HANDLER_RETURN> = UnknownIfNever<
  | InferredDirectSuccessBody<AwaitedHandlerReturn<HANDLER_RETURN>>
  | InferredStatusSuccessBody<AwaitedHandlerReturn<HANDLER_RETURN>>
>

type InferredDirectSuccessBody<VALUE> = VALUE extends unknown
  ? VALUE extends StatusResponse<number, unknown> | Response | void | undefined
    ? never
    : EndpointWireValue<VALUE>
  : never

type InferredStatusSuccessBody<VALUE> =
  VALUE extends StatusResponse<infer STATUS extends number, infer BODY>
    ? IsSuccessStatus<STATUS> extends true
      ? EndpointWireValue<BODY>
      : never
    : never

type InferredEndpointResultValue<HANDLER_RETURN> = UnknownResultIfNever<
  | InferredDirectResult<AwaitedHandlerReturn<HANDLER_RETURN>, true>
  | InferredStatusResult<AwaitedHandlerReturn<HANDLER_RETURN>, true>
  | InferredNativeResponseResult<AwaitedHandlerReturn<HANDLER_RETURN>, true>,
  true
>

type InferredEndpointResultDataValue<HANDLER_RETURN> = UnknownResultIfNever<
  | InferredDirectResult<AwaitedHandlerReturn<HANDLER_RETURN>, false>
  | InferredStatusResult<AwaitedHandlerReturn<HANDLER_RETURN>, false>
  | InferredNativeResponseResult<AwaitedHandlerReturn<HANDLER_RETURN>, false>,
  false
>

type InferredEndpointRawResponseValue<HANDLER_RETURN> = UnknownRawResponseIfNever<
  | InferredDirectRawResponse<AwaitedHandlerReturn<HANDLER_RETURN>>
  | InferredStatusRawResponse<AwaitedHandlerReturn<HANDLER_RETURN>>
  | InferredNativeRawResponse<AwaitedHandlerReturn<HANDLER_RETURN>>
>

type InferredDirectResult<VALUE, WITH_HEADERS extends boolean> = VALUE extends unknown
  ? VALUE extends StatusResponse<number, unknown> | Response | void | undefined
    ? never
    : InferredResult<200, true, EndpointWireValue<VALUE>, WITH_HEADERS>
  : never

type InferredStatusResult<VALUE, WITH_HEADERS extends boolean> =
  VALUE extends StatusResponse<infer STATUS extends number, infer BODY>
    ? InferredResult<STATUS, IsSuccessStatus<STATUS>, EndpointWireValue<BODY>, WITH_HEADERS>
    : never

type InferredNativeResponseResult<VALUE, WITH_HEADERS extends boolean> = VALUE extends Response
  ? InferredResult<number, boolean, unknown, WITH_HEADERS>
  : never

type InferredResult<
  STATUS extends number,
  OK extends boolean,
  BODY,
  WITH_HEADERS extends boolean,
> = WITH_HEADERS extends true
  ? {
      status: STATUS
      ok: OK
      body: BODY
      headers: Headers
    }
  : {
      status: STATUS
      ok: OK
      body: BODY
    }

type InferredDirectRawResponse<VALUE> = VALUE extends unknown
  ? VALUE extends StatusResponse<number, unknown> | Response | void | undefined
    ? never
    : TypedRawResponse<200, true, EndpointWireValue<VALUE>>
  : never

type InferredStatusRawResponse<VALUE> =
  VALUE extends StatusResponse<infer STATUS extends number, infer BODY>
    ? TypedRawResponse<STATUS, IsSuccessStatus<STATUS>, EndpointWireValue<BODY>>
    : never

type InferredNativeRawResponse<VALUE> = VALUE extends Response
  ? TypedRawResponse<number, boolean, unknown>
  : never

type UnknownResultIfNever<VALUE, WITH_HEADERS extends boolean> = [VALUE] extends [never]
  ? InferredResult<number, boolean, unknown, WITH_HEADERS>
  : VALUE

type UnknownRawResponseIfNever<VALUE> = [VALUE] extends [never]
  ? TypedRawResponse<number, boolean, unknown>
  : VALUE

export type EndpointAsyncData<DATA, ERROR = unknown> = EndpointAsyncDataState<DATA, ERROR> &
  Promise<EndpointAsyncDataState<DATA, ERROR>>

export type EndpointAsyncDataState<DATA, ERROR = unknown> = {
  data: EndpointRef<DATA>
  pending: EndpointRef<boolean>
  error: EndpointRef<ERROR | undefined>
  status: EndpointRef<EndpointAsyncDataStatus>
  refresh: (options?: EndpointAsyncDataExecuteOptions) => Promise<void>
  execute: (options?: EndpointAsyncDataExecuteOptions) => Promise<void>
  clear: () => void
}

export type EndpointRef<VALUE> = {
  value: VALUE
}

export type EndpointAsyncDataStatus = 'idle' | 'pending' | 'success' | 'error'

export type EndpointAsyncDataExecuteOptions = {
  dedupe?: 'cancel' | 'defer'
  cause?: EndpointAsyncDataRefreshCause
  signal?: AbortSignal
  timeout?: number
}

export type EndpointAsyncDataRefreshCause = 'initial' | 'refresh:hook' | 'refresh:manual' | 'watch'

export type UseEndpointOptions<RESULT, DATA = RESULT, DEFAULT = undefined> = {
  key?: string
  server?: boolean
  lazy?: boolean
  default?: () => DEFAULT | EndpointRef<DEFAULT>
  transform?: (input: RESULT) => DATA | Promise<DATA>
  pick?: string[]
  watch?: unknown[] | false
  immediate?: boolean
  getCachedData?: (
    key: string,
    nuxtApp: unknown,
    context: { cause: EndpointAsyncDataRefreshCause },
  ) => DATA | undefined
  deep?: boolean
  dedupe?: 'cancel' | 'defer'
  timeout?: number
}

export type EndpointFetcherRawResponse = {
  status: number
  statusText?: string
  ok: boolean
  headers: Headers
  _data?: unknown
}

export type EndpointFetcherRuntime = {
  (path: string, options: Record<string, unknown>): Promise<unknown>
  raw: (path: string, options: Record<string, unknown>) => Promise<EndpointFetcherRawResponse>
}

export type EndpointClientExtension = {
  createCallExtension?: (call: EndpointCallRuntime) => Record<string, unknown>
}

export type EndpointClientRuntimeOptions = {
  features?: Partial<EndpointClientFeatureOptions>
  extensions?: EndpointClientExtension[]
  fetcher?: EndpointFetcherRuntime
}

export type EndpointCallRuntime = {
  data: () => Promise<unknown>
  result: () => Promise<EndpointResultRuntime>
  raw: () => Promise<Response>
  request: EndpointRequestFunctions
}

export type EndpointRequestRuntime<VALUE> = (signal?: AbortSignal) => Promise<VALUE>

export type EndpointRequestFunctions = {
  data: EndpointRequestRuntime<unknown>
  result: EndpointRequestRuntime<EndpointResultRuntime>
  raw: EndpointRequestRuntime<Response>
}

export type EndpointRequestRuntimeOptions = {
  fetcher?: EndpointFetcherRuntime
}

export type EndpointResultRuntime = {
  status: number
  ok: boolean
  body: unknown
  headers: Headers
}

export type EndpointResultDataRuntime = Omit<EndpointResultRuntime, 'headers'>

export type EndpointClientRouteConfig = {
  path: string
  method: HttpMethod
  operation?: string
  idempotency?: {
    headerName: string
    required: boolean
  }
  /**
   * Set when the route declares a media response. Build-time metadata, the
   * runtime half of the `HasMediaResponseContract` type branch: it is what
   * tells the fetcher to hand back the body unread.
   */
  mediaResponse?: true
}

export type EndpointClientRouteConfigInput =
  | readonly EndpointClientRouteConfig[]
  | Record<string, Omit<EndpointClientRouteConfig, 'operation'>>

export type EndpointClientRuntimeValue = (
  request: string,
  options?: Record<string, unknown>,
) => EndpointCallRuntimeValue

export type UseEndpointClientRuntimeValue = (
  path: string,
  options?: Record<string, unknown>,
) => unknown

export type UseEndpointResultClientRuntimeValue = (
  path: string,
  options?: Record<string, unknown>,
) => unknown

export type EndpointEffectRunnerRuntime = (
  program: unknown,
  signal: AbortSignal | undefined,
) => Promise<unknown>

export type EndpointEffectComposerRuntime = (program: unknown) => unknown

export type UseEndpointEffectClientRuntimeValue = (
  path: string,
  options?: Record<string, unknown>,
  compose?: EndpointEffectComposerRuntime,
) => unknown

type UseAsyncDataRuntime = (
  key: string,
  handler: (nuxtApp: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>,
  options?: Record<string, unknown>,
) => unknown

const endpointCallRuntimeSymbol = Symbol('nuxt-endpoints.call-runtime')

export function createEndpointClient(
  routesInput: EndpointClientRouteConfigInput,
  options: EndpointClientRuntimeOptions = {},
) {
  const features = resolveClientFeatures(options.features)
  const routes = normalizeRoutes(routesInput)
  const extensions = options.extensions || []
  const fetcher = options.fetcher
  const client = ((request: string, callOptions = {}) => {
    const { route, endpointOptions } = resolveEndpointRoute(routes, request, callOptions)

    return createEndpointCall(route, endpointOptions, features, extensions, fetcher)
  }) as EndpointClientRuntimeValue
  attachEndpointOperationAliases(client, routes, features, extensions, fetcher)

  return client
}

export function createUseEndpoint(
  routesInput: EndpointClientRouteConfigInput,
  useAsyncData: UseAsyncDataRuntime,
  options: EndpointClientRuntimeOptions = {},
) {
  const features = resolveClientFeatures(options.features)
  const routes = normalizeRoutes(routesInput)
  const extensions = options.extensions || []
  const fetcher = options.fetcher
  const client = ((request: string, callOptions = {}) => {
    const { route, endpointOptions } = resolveEndpointRoute(routes, request, callOptions)
    return createUseEndpointCall(
      route,
      endpointOptions,
      useAsyncData,
      features,
      extensions,
      fetcher,
      'data',
    )
  }) as UseEndpointClientRuntimeValue

  return client
}

export function createUseEndpointResult(
  routesInput: EndpointClientRouteConfigInput,
  useAsyncData: UseAsyncDataRuntime,
  options: EndpointClientRuntimeOptions = {},
) {
  const features = resolveClientFeatures(options.features)
  const routes = normalizeRoutes(routesInput)
  const extensions = options.extensions || []
  const fetcher = options.fetcher
  const client = ((request: string, callOptions = {}) => {
    const { route, endpointOptions } = resolveEndpointRoute(routes, request, callOptions)
    return createUseEndpointCall(
      route,
      endpointOptions,
      useAsyncData,
      features,
      extensions,
      fetcher,
      'result',
    )
  }) as UseEndpointResultClientRuntimeValue

  return client
}

export function createUseEndpointEffectClient(
  routesInput: EndpointClientRouteConfigInput,
  useAsyncData: UseAsyncDataRuntime,
  runEffect: EndpointEffectRunnerRuntime,
  options: EndpointClientRuntimeOptions = {},
) {
  const features = resolveClientFeatures(options.features)
  const routes = normalizeRoutes(routesInput)
  const extensions = options.extensions || []
  const fetcher = options.fetcher
  const client = ((request: string, callOptions = {}, compose) => {
    const { route, endpointOptions } = resolveEndpointRoute(routes, request, callOptions)
    return createUseEndpointEffectCall(
      route,
      endpointOptions,
      compose,
      useAsyncData,
      runEffect,
      features,
      extensions,
      fetcher,
    )
  }) as UseEndpointEffectClientRuntimeValue

  return client
}

type EndpointCallRuntimeValue = PromiseLike<unknown> &
  Pick<Promise<unknown>, 'catch' | 'finally'> & {
    result: () => Promise<EndpointResultRuntime>
    raw: () => Promise<Response>
    [endpointCallRuntimeSymbol]: EndpointCallRuntime
    [key: string]: unknown
  }

export function normalizeRoutes(
  routesInput: EndpointClientRouteConfigInput,
): EndpointClientRouteConfig[] {
  if (Array.isArray(routesInput)) {
    return [...routesInput]
  }

  return Object.entries(routesInput).map(([operation, route]) => {
    return { ...route, operation }
  })
}

function attachEndpointOperationAliases(
  client: EndpointClientRuntimeValue,
  routes: EndpointClientRouteConfig[],
  features: EndpointClientFeatureOptions,
  extensions: EndpointClientExtension[],
  fetcher: EndpointFetcherRuntime | undefined,
) {
  for (const route of routes) {
    if (!route.operation || isReservedEndpointOperationAlias(route.operation)) {
      continue
    }

    Object.defineProperty(client, route.operation, {
      configurable: true,
      enumerable: true,
      value(callOptions: Record<string, unknown> = {}) {
        const resolved = resolveEndpointRoute(routes, route.operation as string, callOptions)
        return createEndpointCall(
          resolved.route,
          resolved.endpointOptions,
          features,
          extensions,
          fetcher,
        )
      },
    })
  }
}

// Single source for both the runtime guard below and the compile-time
// `EndpointOperationAliasReservedKey` union, so a name skipped at runtime can
// never be offered as a typed `$endpoint.<operation>()` alias (and vice versa).
const reservedEndpointOperationAliasList = [
  '__proto__',
  'arguments',
  'caller',
  'catch',
  'constructor',
  'finally',
  'length',
  'name',
  'prototype',
  'then',
  'apply',
  'bind',
  'call',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf',
] as const

const reservedEndpointOperationAliases = new Set<string>(reservedEndpointOperationAliasList)

export function isReservedEndpointOperationAlias(operation: string) {
  return reservedEndpointOperationAliases.has(operation)
}

function resolveEndpointRoute(
  routes: EndpointClientRouteConfig[],
  request: string,
  options: Record<string, unknown>,
) {
  const { method, ...endpointOptions } = options

  if (!request.startsWith('/')) {
    if (method !== undefined) {
      throw new Error(`Endpoint operation calls do not take a method: ${request}`)
    }

    const route = routes.find((route) => route.operation === request)

    if (!route) {
      throw new Error(`Unknown endpoint operation: ${request}`)
    }

    return {
      route,
      endpointOptions,
    }
  }

  if (typeof method !== 'string') {
    throw new Error(`Endpoint path calls require a method: ${request}`)
  }

  const route = routes.find((route) => route.path === request && route.method === method)

  if (!route) {
    throw new Error(`Unknown endpoint route: ${method.toUpperCase()} ${request}`)
  }

  return {
    route,
    endpointOptions,
  }
}

export function createEndpointRequest(
  route: EndpointClientRouteConfig,
  options: Record<string, unknown> = {},
  runtimeOptions: EndpointRequestRuntimeOptions = {},
): EndpointRequestFunctions {
  const { params, idempotencyKey, mediaType, accept, ...fetchOptions } = options
  applyIdempotencyClientOptions(route, fetchOptions, idempotencyKey)
  applyAcceptClientOptions(fetchOptions, accept)
  // `mediaType` is a client-only selector for a media-type-map `body`
  // contract (see `EndpointBodyMediaTypeClientOptions` in contract.ts) - it
  // is never a wire value itself, so it is destructured out above and only
  // reaches `applyMediaTypeClientOptions` for header bookkeeping, never the
  // fetcher's options.
  applyMediaTypeClientOptions(fetchOptions, mediaType)
  applyMediaResponseClientOptions(route, fetchOptions)
  const path = replaceParams(route.path, params)
  const fetcher = runtimeOptions.fetcher

  const data: EndpointRequestRuntime<unknown> = (signal) => {
    return resolveEndpointFetcher(fetcher)(
      path,
      withAbortSignal(signal, {
        ...fetchOptions,
        method: route.method,
      }),
    )
  }

  const result: EndpointRequestRuntime<EndpointResultRuntime> = (signal) => {
    return fetchResult(
      path,
      withAbortSignal(signal, {
        ...fetchOptions,
        method: route.method,
        ignoreResponseError: true,
      }),
      fetcher,
    )
  }

  const raw: EndpointRequestRuntime<Response> = (signal) => {
    return fetchNativeResponse(
      path,
      withAbortSignal(signal, {
        ...fetchOptions,
        method: route.method,
        ignoreResponseError: true,
      }),
      fetcher,
    )
  }

  return { data, result, raw }
}

/**
 * Asks the server for one of the representations the endpoint declares. Sent
 * as `Accept`, and destructured out of the caller's options rather than passed
 * through, because it is a contract-level selector rather than a fetch option.
 * A header the caller set explicitly wins.
 */
function applyAcceptClientOptions(fetchOptions: Record<string, unknown>, accept: unknown): void {
  if (accept === undefined) {
    return
  }
  // Strict like its sibling selectors (`mediaType`, `idempotencyKey`) rather
  // than silently ignoring a wrong value: a dropped `accept` would come back
  // as the wrong representation, which is harder to trace than a throw.
  if (typeof accept !== 'string' || accept.trim() === '') {
    throw new TypeError('Endpoint accept option must be a non-empty string')
  }

  const headers = fetchOptions.headers
  // `HeadersInit` has three shapes and all three reach the fetcher. Treating
  // only the record case as this once did discarded every caller header for
  // the other two - including the `Idempotency-Key` set moments earlier, which
  // turned an idempotent write into an ordinary one.
  if (headers instanceof Headers) {
    if (headers.has('accept')) {
      return
    }
    const nextHeaders = new Headers(headers)
    nextHeaders.set('accept', accept)
    fetchOptions.headers = nextHeaders
    return
  }
  if (Array.isArray(headers)) {
    const nextHeaders = new Headers(headers as [string, string][])
    if (nextHeaders.has('accept')) {
      return
    }
    nextHeaders.set('accept', accept)
    fetchOptions.headers = nextHeaders
    return
  }
  if (headers !== undefined && (typeof headers !== 'object' || headers === null)) {
    throw new TypeError('Endpoint headers must be a Headers object, tuple list, or record')
  }

  const headerRecord = (headers ?? {}) as Record<string, unknown>
  if (Object.keys(headerRecord).some((name) => name.toLowerCase() === 'accept')) {
    return
  }
  fetchOptions.headers = { ...headerRecord, accept }
}

/**
 * Stops the fetcher from parsing the response of a route with a media
 * response, so the caller receives the body while it is still arriving rather
 * than a decoded copy of it once it has all arrived. An explicit caller
 * `responseType` still wins - asking for `'blob'` on a download is a
 * legitimate choice.
 */
function applyMediaResponseClientOptions(
  route: EndpointClientRouteConfig,
  fetchOptions: Record<string, unknown>,
): void {
  if (!route.mediaResponse || fetchOptions.responseType !== undefined) {
    return
  }
  fetchOptions.responseType = 'stream'
}

function applyIdempotencyClientOptions(
  route: EndpointClientRouteConfig,
  fetchOptions: Record<string, unknown>,
  idempotencyKey: unknown,
): void {
  const metadata = route.idempotency
  if (!metadata) {
    if (idempotencyKey !== undefined) {
      throw new Error(`Endpoint ${route.method.toUpperCase()} ${route.path} is not idempotent`)
    }
    return
  }

  if (idempotencyKey === undefined) {
    if (metadata.required) {
      throw new Error(`idempotencyKey is required for ${route.method.toUpperCase()} ${route.path}`)
    }
    return
  }
  if (
    typeof idempotencyKey !== 'string' ||
    idempotencyKey.length === 0 ||
    idempotencyKey.length > 255 ||
    idempotencyKey.includes(',') ||
    hasHttpControlCharacter(idempotencyKey)
  ) {
    throw new TypeError(
      'idempotencyKey must be a non-empty string of at most 255 characters without commas or control characters',
    )
  }

  const headers = fetchOptions.headers
  if (headers instanceof Headers) {
    if (headers.has(metadata.headerName)) {
      throwDuplicateIdempotencyHeader(metadata.headerName)
    }
    const nextHeaders = new Headers(headers)
    nextHeaders.set(metadata.headerName, idempotencyKey)
    fetchOptions.headers = nextHeaders
    return
  }
  if (Array.isArray(headers)) {
    const nextHeaders = new Headers(headers as [string, string][])
    if (nextHeaders.has(metadata.headerName)) {
      throwDuplicateIdempotencyHeader(metadata.headerName)
    }
    nextHeaders.set(metadata.headerName, idempotencyKey)
    fetchOptions.headers = nextHeaders
    return
  }
  if (headers !== undefined && (typeof headers !== 'object' || headers === null)) {
    throw new TypeError('Endpoint headers must be a Headers object, tuple list, or record')
  }

  const headerRecord = (headers ?? {}) as Record<string, unknown>
  if (
    Object.keys(headerRecord).some(
      (name) => name.toLowerCase() === metadata.headerName.toLowerCase(),
    )
  ) {
    throwDuplicateIdempotencyHeader(metadata.headerName)
  }
  fetchOptions.headers = { ...headerRecord, [metadata.headerName]: idempotencyKey }
}

function applyMediaTypeClientOptions(
  fetchOptions: Record<string, unknown>,
  mediaType: unknown,
): void {
  if (mediaType === undefined) {
    return
  }
  if (typeof mediaType !== 'string') {
    throw new TypeError('Endpoint mediaType option must be a string')
  }

  if (mediaType === 'multipart/form-data') {
    // The only media type the client cannot label: a `FormData` body needs a
    // Content-Type carrying a runtime-generated boundary
    // (`multipart/form-data; boundary=...`), and writing a bare
    // `multipart/form-data` here would strip it. The header therefore has to
    // come from whatever constructs the request. A real fetch does that; a
    // Nuxt server-side call to a local route does not, because it dispatches
    // into the handler without building a `Request`. Multipart calls belong
    // on the client for that reason - see the media-type body docs.
    return
  }

  // Every other declared media type is a fixed string the client can set
  // itself, so the request carries it regardless of how it is dispatched.
  // A caller-supplied Content-Type always wins.
  setContentTypeHeaderIfAbsent(fetchOptions, mediaType)
}

// Mirrors the header-shape handling in `applyIdempotencyClientOptions`
// above (Headers instance / tuple list / plain record), but sets the header
// only when the caller has not already supplied a content-type - the
// caller's own `headers` option always wins.
function setContentTypeHeaderIfAbsent(
  fetchOptions: Record<string, unknown>,
  contentType: string,
): void {
  const headers = fetchOptions.headers

  if (headers instanceof Headers) {
    if (headers.has('content-type')) {
      return
    }
    const nextHeaders = new Headers(headers)
    nextHeaders.set('content-type', contentType)
    fetchOptions.headers = nextHeaders
    return
  }
  if (Array.isArray(headers)) {
    const nextHeaders = new Headers(headers as [string, string][])
    if (nextHeaders.has('content-type')) {
      return
    }
    nextHeaders.set('content-type', contentType)
    fetchOptions.headers = nextHeaders
    return
  }
  if (headers !== undefined && (typeof headers !== 'object' || headers === null)) {
    throw new TypeError('Endpoint headers must be a Headers object, tuple list, or record')
  }

  const headerRecord = (headers ?? {}) as Record<string, unknown>
  if (Object.keys(headerRecord).some((name) => name.toLowerCase() === 'content-type')) {
    return
  }
  fetchOptions.headers = { ...headerRecord, 'content-type': contentType }
}

function throwDuplicateIdempotencyHeader(headerName: string): never {
  throw new Error(`Do not supply both idempotencyKey and ${headerName} in endpoint request headers`)
}

function createEndpointCall(
  route: EndpointClientRouteConfig,
  options: Record<string, unknown>,
  features: EndpointClientFeatureOptions,
  extensions: EndpointClientExtension[],
  fetcher?: EndpointFetcherRuntime,
): EndpointCallRuntimeValue {
  let dataPromise: Promise<unknown> | undefined
  let resultPromise: Promise<EndpointResultRuntime> | undefined
  let rawPromise: Promise<Response> | undefined

  const request = createEndpointRequest(route, options, { fetcher })

  const data = () => {
    dataPromise ||= request.data()

    return dataPromise
  }

  const result = () => {
    resultPromise ||= request.result()

    return resultPromise
  }

  const raw = () => {
    rawPromise ||= request.raw()

    return rawPromise
  }

  const callRuntime: EndpointCallRuntime = {
    data,
    result,
    raw,
    request,
  }

  const call = {
    // oxlint-disable-next-line unicorn/no-thenable -- Endpoint calls intentionally behave like ky-style Promise-like requests.
    then(
      onfulfilled: Parameters<Promise<unknown>['then']>[0],
      onrejected: Parameters<Promise<unknown>['then']>[1],
    ) {
      return data().then(onfulfilled, onrejected)
    },
    catch(onrejected: Parameters<Promise<unknown>['catch']>[0]) {
      return data().catch(onrejected)
    },
    finally(onfinally: Parameters<Promise<unknown>['finally']>[0]) {
      return data().finally(onfinally)
    },
  } as unknown as EndpointCallRuntimeValue
  call[endpointCallRuntimeSymbol] = callRuntime

  if (features.result) {
    call.result = result
  }
  if (features.raw) {
    call.raw = raw
  }

  for (const extension of extensions) {
    Object.assign(call, extension.createCallExtension?.(callRuntime))
  }

  return call
}

function createUseEndpointCall(
  route: EndpointClientRouteConfig,
  options: Record<string, unknown>,
  useAsyncData: UseAsyncDataRuntime,
  features: EndpointClientFeatureOptions,
  extensions: EndpointClientExtension[],
  fetcher: EndpointFetcherRuntime | undefined,
  requestMode: UseEndpointKeyKind,
) {
  const { endpointOptions, asyncDataOptions, key } = splitUseEndpointOptions(
    route,
    options,
    requestMode,
  )
  const call = createEndpointCall(route, endpointOptions, features, extensions, fetcher)
  const runtime = call[endpointCallRuntimeSymbol]

  return useAsyncData(
    key,
    (_nuxtApp, options) => {
      if (requestMode === 'result') {
        return runtime.request.result(options?.signal).then(toEndpointResultData)
      }

      return runtime.request.data(options?.signal)
    },
    asyncDataOptions,
  )
}

function createUseEndpointEffectCall(
  route: EndpointClientRouteConfig,
  options: Record<string, unknown>,
  compose: EndpointEffectComposerRuntime | undefined,
  useAsyncData: UseAsyncDataRuntime,
  runEffect: EndpointEffectRunnerRuntime,
  features: EndpointClientFeatureOptions,
  extensions: EndpointClientExtension[],
  fetcher: EndpointFetcherRuntime | undefined,
) {
  const { endpointOptions, asyncDataOptions, key } = splitUseEndpointOptions(
    route,
    options,
    'effect',
  )
  const call = createEndpointCall(route, endpointOptions, features, extensions, fetcher)
  const effectCall = call as EndpointCallRuntimeValue & {
    effect?: () => unknown
  }

  if (!effectCall.effect) {
    throw new Error('useEndpointEffect requires endpoints.client.effect to be enabled.')
  }

  return useAsyncData(
    key,
    (_nuxtApp, options) => {
      const program = effectCall.effect?.()
      return runEffect(compose ? compose(program) : program, options?.signal)
    },
    asyncDataOptions,
  )
}

function splitUseEndpointOptions(
  route: EndpointClientRouteConfig,
  options: Record<string, unknown>,
  keyKind: UseEndpointKeyKind,
): {
  endpointOptions: Record<string, unknown>
  asyncDataOptions: Record<string, unknown>
  key: string
} {
  const {
    key,
    server,
    lazy,
    default: defaultValue,
    transform,
    pick,
    watch,
    immediate,
    getCachedData,
    deep,
    dedupe,
    timeout,
    ...endpointOptions
  } = options

  const asyncDataOptions = compactOptions({
    server,
    lazy,
    default: defaultValue,
    transform,
    pick,
    watch: watch === false ? [] : watch,
    immediate,
    getCachedData,
    deep,
    dedupe,
    timeout,
  })

  return {
    endpointOptions,
    asyncDataOptions,
    key:
      typeof key === 'string' && key.length > 0
        ? key
        : createUseEndpointKey(route, endpointOptions, keyKind),
  }
}

function compactOptions(options: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined))
}

function createUseEndpointKey(
  route: EndpointClientRouteConfig,
  endpointOptions: Record<string, unknown>,
  keyKind: UseEndpointKeyKind,
): string {
  const requestKey = stableStringify(endpointOptions)
  const suffix = requestKey ? `:${requestKey}` : ''
  const prefix = keyKind === 'data' ? '$endpoint' : `$endpoint-${keyKind}`

  return `${prefix}:${route.method}:${route.path}${suffix}`
}

type UseEndpointKeyKind = 'data' | 'result' | 'effect'

function toEndpointResultData(result: EndpointResultRuntime): EndpointResultDataRuntime {
  return {
    status: result.status,
    ok: result.ok,
    body: result.body,
  }
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(sortSerializableValue(value))
  } catch {
    return ''
  }
}

export function normalizeEndpointRequestKey(value: unknown): unknown {
  return sortSerializableValue(value)
}

function sortSerializableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortSerializableValue)
  }
  if (!value || typeof value !== 'object') {
    return value
  }

  const record = value as Record<string, unknown>

  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sortSerializableValue(record[key])]),
  )
}

function resolveClientFeatures(
  features: Partial<EndpointClientFeatureOptions> | undefined,
): EndpointClientFeatureOptions {
  return {
    result: features?.result ?? true,
    raw: features?.raw ?? true,
  }
}

function withAbortSignal(
  signal: AbortSignal | undefined,
  options: Record<string, unknown>,
): Record<string, unknown> {
  if (!signal) {
    return options
  }
  return {
    ...options,
    signal,
  }
}

function resolveEndpointFetcher(
  fetcher: EndpointFetcherRuntime | undefined,
): EndpointFetcherRuntime {
  return fetcher ?? ($fetch as unknown as EndpointFetcherRuntime)
}

async function fetchResult(
  path: string,
  options: Record<string, unknown>,
  fetcher: EndpointFetcherRuntime | undefined,
): Promise<EndpointResultRuntime> {
  const response = await resolveEndpointFetcher(fetcher).raw(path, options)

  return {
    status: response.status,
    ok: response.ok,
    body: response._data,
    headers: response.headers,
  }
}

async function fetchNativeResponse(
  path: string,
  options: Record<string, unknown>,
  fetcher: EndpointFetcherRuntime | undefined,
): Promise<Response> {
  const response = await fetchRawResponse(path, options, fetcher)
  return toNativeResponse(response)
}

async function fetchRawResponse(
  path: string,
  options: Record<string, unknown>,
  fetcher: EndpointFetcherRuntime | undefined,
): Promise<EndpointFetcherRawResponse> {
  return await resolveEndpointFetcher(fetcher).raw(path, options)
}

function toNativeResponse(response: {
  status: number
  statusText?: string
  headers: Headers
  _data?: unknown
}): Response {
  const headers = new Headers(response.headers)
  const body = responseBody(response._data)

  if (body && !headers.has('content-type') && isJsonResponseBody(response._data)) {
    headers.set('content-type', 'application/json')
  }

  return new Response(isBodyAllowed(response.status) ? body : null, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function responseBody(data: unknown): BodyInit | null {
  if (data === undefined || data === null) {
    return null
  }
  if (
    typeof data === 'string' ||
    data instanceof Blob ||
    data instanceof ArrayBuffer ||
    data instanceof FormData ||
    data instanceof URLSearchParams ||
    data instanceof ReadableStream
  ) {
    return data
  }
  return JSON.stringify(data)
}

function isJsonResponseBody(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    !(data instanceof Blob) &&
    // An unread stream is bytes of some declared media type, never JSON. It
    // reaches here whenever a route declares a media response, because the
    // fetcher was told not to parse that route's body.
    !(data instanceof ReadableStream)
  )
}

function isBodyAllowed(status: number): boolean {
  return status !== 204 && status !== 205 && status !== 304
}

function replaceParams(path: string, params: unknown): string {
  const values =
    params && typeof params === 'object' ? (params as Record<string, unknown>) : undefined

  return replacePathParams(path, (key) => {
    const value = values?.[key]
    if (value === undefined || value === null) {
      throw new Error(`Missing path parameter "${key}" for endpoint path: ${path}`)
    }
    // Standard Schema inputs can intentionally define custom string coercion
    // (for example URL or Date), so preserve the existing runtime contract.
    // oxlint-disable-next-line typescript/no-base-to-string
    return encodeURIComponent(String(value))
  })
}
