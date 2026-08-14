import { Effect } from 'effect'
import type {
  DefaultEndpointClientFeatures,
  EndpointCall,
  EndpointClientFeatureOptions,
  EndpointClientExtension,
  EndpointAsyncData,
  EndpointClientRuntimeOptions,
  EndpointOperationAliasCallArgs,
  EndpointOperationAliasKey,
  EndpointOperationCallArgs,
  EndpointPathClientOptions,
  EndpointOperation,
  EndpointPath,
  EndpointResult,
  EndpointRouteMethod,
  EndpointRouteEntry,
  UseEndpointClientOptions,
} from './client'
import { createUseEndpointEffectClient } from './client'
import type { EndpointClientOptionsAreOptional } from './contract'

export class EndpointClientError extends Error {
  readonly _tag = 'EndpointClientError'
  readonly cause: unknown

  constructor(cause: unknown) {
    super('Endpoint client request failed')
    this.name = 'EndpointClientError'
    this.cause = cause
  }
}

export type EffectEndpointCall<
  ROUTE extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = EndpointCall<ROUTE, FEATURES> & {
  effect: () => Effect.Effect<EndpointResult<ROUTE>, EndpointClientError>
}

export type EffectEndpointClient<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = EffectEndpointPathCaller<ROUTES, FEATURES> &
  EffectEndpointOperationCaller<ROUTES, FEATURES> &
  EffectEndpointOperationAliases<ROUTES, FEATURES>

export type EffectEndpointPathCaller<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = <
  const PATH extends EndpointPath<ROUTES>,
  const METHOD extends EndpointRouteMethod<ROUTES, PATH>,
  ROUTE extends Extract<ROUTES, { path: PATH; method: METHOD }>,
>(
  path: PATH,
  options: EndpointPathClientOptions<ROUTE, METHOD>,
) => EffectEndpointCall<ROUTE, FEATURES>

export type EffectEndpointOperationCaller<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = <
  const OPERATION extends EndpointOperation<ROUTES>,
  ROUTE extends Extract<ROUTES, { operation: OPERATION }>,
>(
  ...args: EndpointOperationCallArgs<OPERATION, ROUTE>
) => EffectEndpointCall<ROUTE, FEATURES>

export type EffectEndpointOperationAliases<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = {
  [OPERATION in EndpointOperation<ROUTES> as EndpointOperationAliasKey<OPERATION>]: (
    ...args: EndpointOperationAliasCallArgs<Extract<ROUTES, { operation: OPERATION }>>
  ) => EffectEndpointCall<Extract<ROUTES, { operation: OPERATION }>, FEATURES>
}

export type EffectEndpointPathCall<
  ROUTES extends EndpointRouteEntry,
  PATH extends EndpointPath<ROUTES>,
  METHOD extends EndpointRouteMethod<ROUTES, PATH>,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = EffectEndpointCall<Extract<ROUTES, { path: PATH; method: METHOD }>, FEATURES>

export type EffectEndpointOperationCall<
  ROUTES extends EndpointRouteEntry,
  OPERATION extends EndpointOperation<ROUTES>,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = EffectEndpointCall<Extract<ROUTES, { operation: OPERATION }>, FEATURES>

export type UseEndpointEffectClient<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = UseEndpointEffectCaller<ROUTES, FEATURES>

export type UseEndpointEffectCaller<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = UseEndpointEffectPathCaller<ROUTES, FEATURES> &
  UseEndpointEffectOperationCaller<ROUTES, FEATURES>

export type UseEndpointEffectPathCaller<
  ROUTES extends EndpointRouteEntry,
  _FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = <
  const PATH extends EndpointPath<ROUTES>,
  const METHOD extends EndpointRouteMethod<ROUTES, PATH>,
  ROUTE extends Extract<ROUTES, { path: PATH; method: METHOD }>,
  RESULT = EndpointResult<ROUTE>,
  DATA = RESULT,
  DEFAULT = undefined,
  ERROR = EndpointClientError,
>(
  path: PATH,
  options: UseEndpointClientOptions<ROUTE, RESULT, DATA, DEFAULT> & {
    method: METHOD
  },
  compose?: (
    program: Effect.Effect<EndpointResult<ROUTE>, EndpointClientError>,
  ) => Effect.Effect<RESULT, ERROR>,
) => EndpointAsyncData<DATA | DEFAULT, ERROR>

export type UseEndpointEffectOperationCaller<
  ROUTES extends EndpointRouteEntry,
  _FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = <
  const OPERATION extends EndpointOperation<ROUTES>,
  ROUTE extends Extract<ROUTES, { operation: OPERATION }>,
  RESULT = EndpointResult<ROUTE>,
  DATA = RESULT,
  DEFAULT = undefined,
  ERROR = EndpointClientError,
>(
  ...args: UseEndpointEffectOperationArgs<OPERATION, ROUTE, RESULT, DATA, DEFAULT, ERROR>
) => EndpointAsyncData<DATA | DEFAULT, ERROR>

export type UseEndpointEffectClientMethod<
  ROUTE extends EndpointRouteEntry,
  _FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = <
  RESULT = EndpointResult<ROUTE>,
  DATA = RESULT,
  DEFAULT = undefined,
  ERROR = EndpointClientError,
>(
  path: ROUTE['path'],
  options: UseEndpointClientOptions<ROUTE, RESULT, DATA, DEFAULT> & {
    method: ROUTE['method']
  },
  compose?: (
    program: Effect.Effect<EndpointResult<ROUTE>, EndpointClientError>,
  ) => Effect.Effect<RESULT, ERROR>,
) => EndpointAsyncData<DATA | DEFAULT, ERROR>

export type UseEndpointEffectOperationArgs<
  OPERATION extends string,
  ROUTE extends EndpointRouteEntry,
  RESULT,
  DATA,
  DEFAULT,
  ERROR,
> =
  EndpointClientOptionsAreOptional<ROUTE['definition']> extends true
    ? [
        operation: OPERATION,
        options?: UseEndpointClientOptions<ROUTE, RESULT, DATA, DEFAULT>,
        compose?: (
          program: Effect.Effect<EndpointResult<ROUTE>, EndpointClientError>,
        ) => Effect.Effect<RESULT, ERROR>,
      ]
    : [
        operation: OPERATION,
        options: UseEndpointClientOptions<ROUTE, RESULT, DATA, DEFAULT>,
        compose?: (
          program: Effect.Effect<EndpointResult<ROUTE>, EndpointClientError>,
        ) => Effect.Effect<RESULT, ERROR>,
      ]

export function createEndpointEffectExtension(): EndpointClientExtension {
  return {
    createCallExtension(call) {
      return {
        effect() {
          return toEndpointEffect(call.request.result)
        },
      }
    },
  }
}

export function createUseEndpointEffect(
  routesInput: Parameters<typeof createUseEndpointEffectClient>[0],
  useAsyncData: Parameters<typeof createUseEndpointEffectClient>[1],
  options: EndpointClientRuntimeOptions = {},
) {
  return createUseEndpointEffectClient(
    routesInput,
    useAsyncData,
    (program, signal) => Effect.runPromise(program as Effect.Effect<unknown, unknown>, { signal }),
    {
      ...options,
      extensions: [...(options.extensions || []), createEndpointEffectExtension()],
    },
  )
}

function toEndpointEffect<VALUE>(
  request: (signal?: AbortSignal) => Promise<VALUE>,
): Effect.Effect<VALUE, EndpointClientError> {
  return Effect.tryPromise({
    try: (signal) => request(signal),
    catch: (cause) => new EndpointClientError(cause),
  })
}
