import type {
  EndpointClientOptions,
  EndpointClientOptionsAreOptional,
  EndpointDefinition,
  EndpointFormContract,
  EndpointResponsesContract,
  EndpointMediaResponseStream,
  EndpointSuccessBody,
  HasEndpointResponses,
  HasMediaResponseContract,
  HttpMethod,
  IsEndpointBodyMediaTypeMap,
  IsSuccessStatus,
  NormalizeResponses,
  ResponseMediaTypes,
  ResponseBody,
  StatusNumber,
  UnknownIfNever,
} from './contract'
import type { ReservedEndpointName } from './endpoint-name'
import { isReservedEndpointName, isValidEndpointName } from './endpoint-name'
import type { FormFieldAttributes, FormInputOf } from './form-schema'
import {
  collectRepeatedEntries,
  endpointNativeSubmissionKey,
  extractFormIssues,
  resolveFormRedirectTemplate,
} from './form-shared'
import type { FormValidationIssue } from './form-shared'
import { hasHttpControlCharacter } from './idempotency'
import { replacePathParams } from './path-template'
import type { StatusResponse } from './response'
import type { EndpointWireValue } from './platform'
import type { ValidatorSchema } from './validators/common'
import type { CursorPaginationPage, EndpointCursorPaginationContract } from './pagination'

export type EndpointRouteEntry = {
  name?: string
  path: string
  method: HttpMethod
  definition: EndpointDefinition
  handlerReturn?: unknown
  serverResponses?: EndpointResponsesContract
}

export type EndpointClientFeatureOptions = {
  raw: boolean
}

export type DefaultEndpointClientFeatures = {
  raw: true
}

export type EndpointClient<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = EndpointPathCaller<ROUTES, FEATURES> & EndpointNamedCalls<ROUTES, FEATURES>

type EndpointName<ROUTES extends EndpointRouteEntry> = ROUTES extends {
  name: infer NAME extends string
}
  ? NAME extends ReservedEndpointName
    ? never
    : NAME
  : never

type EndpointNamedCallArgs<ROUTE extends EndpointRouteEntry> =
  EndpointClientOptionsAreOptional<ROUTE['definition']> extends true
    ? [
        options?: EndpointClientOptions<ROUTE['definition']> extends void
          ? undefined
          : EndpointClientOptions<ROUTE['definition']>,
      ]
    : [options: EndpointClientOptions<ROUTE['definition']>]

type EndpointNamedCalls<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions,
> = {
  [NAME in EndpointName<ROUTES>]: (
    ...args: EndpointNamedCallArgs<Extract<ROUTES, { name: NAME }>>
  ) => EndpointCall<Extract<ROUTES, { name: NAME }>, FEATURES>
}

/**
 * Path/method index emitted by codegen. Keeping lookup indexed avoids
 * repeatedly distributing `Extract` over the complete route union at every
 * client call site.
 */
export type EndpointRouteMap = Record<string, Partial<Record<HttpMethod, EndpointRouteEntry>>>

export type EndpointRouteMapEntry<
  ROUTES,
  PATH extends keyof ROUTES,
  METHOD extends keyof ROUTES[PATH],
> = ROUTES[PATH][METHOD] extends EndpointRouteEntry ? ROUTES[PATH][METHOD] : never

export type EndpointRouteMapValue<ROUTES> = {
  [PATH in keyof ROUTES]: ROUTES[PATH][keyof ROUTES[PATH]]
}[keyof ROUTES] extends infer ROUTE
  ? Extract<ROUTE, EndpointRouteEntry>
  : never

type EndpointMappedClientOptions<
  ROUTE,
  METHOD extends HttpMethod,
> = ROUTE extends EndpointRouteEntry
  ? EndpointClientOptions<ROUTE['definition']> extends void
    ? { method: METHOD }
    : EndpointClientOptions<ROUTE['definition']> & { method: METHOD }
  : never

export type EndpointMappedClient<
  ROUTES,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = (<
  const PATH extends keyof ROUTES & string,
  const METHOD extends keyof ROUTES[PATH] & HttpMethod,
>(
  path: PATH,
  options: EndpointMappedClientOptions<EndpointRouteMapEntry<ROUTES, PATH, METHOD>, METHOD>,
) => EndpointCall<EndpointRouteMapEntry<ROUTES, PATH, METHOD>, FEATURES>) &
  EndpointNamedCalls<EndpointRouteMapValue<ROUTES>, FEATURES>

export type EndpointMappedPathCall<
  ROUTES,
  PATH extends keyof ROUTES & string,
  METHOD extends keyof ROUTES[PATH] & HttpMethod,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = EndpointCall<EndpointRouteMapEntry<ROUTES, PATH, METHOD>, FEATURES>

export type UseEndpointClient<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = UseEndpointCaller<ROUTES, FEATURES>

type EndpointMappedUseClientOptions<
  ROUTE,
  METHOD extends HttpMethod,
  DATA,
  DEFAULT,
> = ROUTE extends EndpointRouteEntry
  ? EndpointClientOptions<ROUTE['definition']> extends void
    ? UseEndpointOptions<EndpointResultData<ROUTE>, DATA, DEFAULT> & { method: METHOD }
    : EndpointClientOptions<ROUTE['definition']> &
        UseEndpointOptions<EndpointResultData<ROUTE>, DATA, DEFAULT> & { method: METHOD }
  : never

export type EndpointMappedUseClient<ROUTES> = <
  const PATH extends keyof ROUTES & string,
  const METHOD extends keyof ROUTES[PATH] & HttpMethod,
  DATA = EndpointResultData<EndpointRouteMapEntry<ROUTES, PATH, METHOD>>,
  DEFAULT = undefined,
>(
  path: PATH,
  options: EndpointMappedUseClientOptions<
    EndpointRouteMapEntry<ROUTES, PATH, METHOD>,
    METHOD,
    DATA,
    DEFAULT
  >,
) => EndpointAsyncData<DATA | DEFAULT>

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

export type UseEndpointCaller<
  ROUTES extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = UseEndpointPathCaller<ROUTES, FEATURES>

export type UseEndpointPathCaller<
  ROUTES extends EndpointRouteEntry,
  _FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = <
  const PATH extends EndpointPath<ROUTES>,
  const METHOD extends EndpointRouteMethod<ROUTES, PATH>,
  ROUTE extends Extract<ROUTES, { path: PATH; method: METHOD }>,
  DATA = EndpointResultData<ROUTE>,
  DEFAULT = undefined,
>(
  path: PATH,
  options: UseEndpointClientOptions<ROUTE, EndpointResultData<ROUTE>, DATA, DEFAULT> & {
    method: METHOD
  },
) => EndpointAsyncData<DATA | DEFAULT>

export type EndpointPath<ROUTES extends EndpointRouteEntry> = ROUTES['path']

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

export type EndpointPathClientOptions<
  ROUTE extends EndpointRouteEntry,
  METHOD extends ROUTE['method'],
> =
  EndpointClientOptions<ROUTE['definition']> extends void
    ? { method: METHOD }
    : EndpointClientOptions<ROUTE['definition']> & { method: METHOD }

export type UseEndpointClientMethod<
  ROUTE extends EndpointRouteEntry,
  _FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = <DATA = EndpointResultData<ROUTE>, DEFAULT = undefined>(
  path: ROUTE['path'],
  options: UseEndpointClientOptions<ROUTE, EndpointResultData<ROUTE>, DATA, DEFAULT> & {
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

export type EndpointCall<
  ROUTE extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions = DefaultEndpointClientFeatures,
> = PromiseLike<EndpointResult<ROUTE>> &
  Pick<Promise<EndpointResult<ROUTE>>, 'catch' | 'finally'> &
  EndpointRawCallFeature<ROUTE, FEATURES> &
  EndpointCallIdentity<ROUTE>

declare const endpointCallRouteType: unique symbol
declare const endpointCallCapabilitiesType: unique symbol

export type EndpointCursorPaginationCapability<PAGE, FAILURE> = {
  readonly kind: 'cursor'
  readonly page: PAGE
  readonly failure: FAILURE
}

export type EndpointCallCapabilityIdentity<CAPABILITIES> = {
  readonly [endpointCallCapabilitiesType]: CAPABILITIES
}

export type EndpointCursorPaginatedRequest<PAGE, FAILURE> = EndpointCallCapabilityIdentity<{
  pagination: EndpointCursorPaginationCapability<PAGE, FAILURE>
}>

type EndpointCallCapabilities<ROUTE extends EndpointRouteEntry> = ROUTE extends {
  method: 'get'
  definition: { pagination: EndpointCursorPaginationContract }
}
  ? {
      pagination: EndpointCursorPaginationCapability<
        EndpointPaginationPage<ROUTE>,
        EndpointPaginationFailure<ROUTE>
      >
    }
  : Record<never, never>

/** Preserves the originating route for adapters without adding runtime data. */
type EndpointCallIdentity<ROUTE extends EndpointRouteEntry> = {
  readonly [endpointCallRouteType]: ROUTE
} & EndpointCallCapabilityIdentity<EndpointCallCapabilities<ROUTE>>

export type EndpointCallQueryOptions<ROUTE extends EndpointRouteEntry> = {
  key: EndpointCacheKey<ROUTE['method']>
  query: (context: { signal: AbortSignal }) => Promise<EndpointResultData<ROUTE>>
}

export type EndpointCallMutationOptions<ROUTE extends EndpointRouteEntry> = {
  key: EndpointCacheKey<ROUTE['method']>
  mutation: () => Promise<EndpointResultData<ROUTE>>
}

export type EndpointPaginationPage<ROUTE extends EndpointRouteEntry> =
  ROUTE['definition']['pagination'] extends EndpointCursorPaginationContract<infer ITEM>
    ? CursorPaginationPage<ITEM>
    : never

export type EndpointPaginationFailure<ROUTE extends EndpointRouteEntry> = Exclude<
  EndpointResultData<ROUTE>,
  { status: 200 }
>

/** A failed page invocation, retaining a typed non-success HTTP result when one exists. */
export class EndpointPaginationError<RESULT = EndpointResultDataRuntime> extends Error {
  readonly result: RESULT | undefined

  constructor(message: string, options: { result?: RESULT; cause?: unknown } = {}) {
    super(message, { cause: options.cause })
    this.name = 'EndpointPaginationError'
    this.result = options.result
  }
}

export type EndpointCallInfiniteQueryOptions<PAGE> = {
  key: EndpointCacheKey<'get'>
  initialPageParam: undefined
  query: (context: { signal: AbortSignal; pageParam: string | undefined }) => Promise<PAGE>
  getNextPageParam: (lastPage: PAGE) => string | undefined
}

export type EndpointCacheKey<METHOD extends HttpMethod = HttpMethod> = readonly [
  'nuxt-endpoints',
  'v2',
  METHOD,
  string,
  string,
]

/** Only a route that declares `form` can be projected into one. */
export type EndpointFormRoute<ROUTES extends EndpointRouteEntry> = Extract<
  ROUTES,
  { definition: { form: EndpointFormContract } }
>

export type UseEndpointFormClient<ROUTES extends EndpointRouteEntry> = <
  const PATH extends EndpointPath<EndpointFormRoute<ROUTES>>,
  const METHOD extends EndpointRouteMethod<EndpointFormRoute<ROUTES>, PATH>,
  ROUTE extends Extract<EndpointFormRoute<ROUTES>, { path: PATH; method: METHOD }>,
>(
  path: PATH,
  options: EndpointPathClientOptions<ROUTE, METHOD> & EndpointFormCallOptions<ROUTE>,
) => EndpointFormCall<ROUTE>

/**
 * The member a browser can actually submit, in the order `findFormBodyMember()`
 * picks it at build time.
 */
type EndpointFormBodyMember<DEFINITION extends EndpointDefinition> = DEFINITION['body'] extends {
  'multipart/form-data': infer MEMBER extends ValidatorSchema
}
  ? MEMBER
  : DEFINITION['body'] extends {
        'application/x-www-form-urlencoded': infer MEMBER extends ValidatorSchema
      }
    ? MEMBER
    : never

type EndpointFormSchema<ROUTE extends EndpointRouteEntry> = ROUTE['definition']['form'] extends {
  method: 'get'
}
  ? ROUTE['definition']['query']
  : EndpointFormBodyMember<ROUTE['definition']>

type EndpointFormMethod<ROUTE extends EndpointRouteEntry> = ROUTE['definition']['form'] extends {
  method: 'get'
}
  ? 'get'
  : 'post'

type EndpointFormFieldName<ROUTE extends EndpointRouteEntry> = keyof FormInputOf<
  EndpointFormSchema<ROUTE>
> &
  string

/** One attribute set per declared field, ready for `v-bind`. */
export type EndpointFormFields<ROUTE extends EndpointRouteEntry> = Record<
  EndpointFormFieldName<ROUTE>,
  FormFieldAttributes & { value?: string; onInput?: (event: Event) => void }
>

export type EndpointFormCall<ROUTE extends EndpointRouteEntry> = {
  /** `action`, `method` and `enctype` for the `<form>` element itself. */
  attrs: {
    action: string
    method: EndpointFormMethod<ROUTE>
    enctype: string
    novalidate?: true
  }
  fields: EndpointFormFields<ROUTE>
  /**
   * The current value of every field the bindings control, which is what
   * `fields` reads and writes. A file is not among them.
   */
  values: EndpointRef<Record<EndpointFormFieldName<ROUTE>, string>>
  /** Sends a submission without going through a `<form>` element. */
  submit: (body: FormData | URLSearchParams) => Promise<EndpointResultData<ROUTE>>
  /** `@submit` handler: takes over the native submission when JavaScript ran. */
  enhance: (event: { preventDefault: () => void; target: unknown }) => Promise<void>
  pending: EndpointRef<boolean>
  result: EndpointRef<EndpointResultData<ROUTE> | undefined>
  /**
   * The status of the last submission, whichever path produced it - the native
   * one leaves no result behind, only what the bridge reported.
   */
  status: EndpointRef<number | undefined>
  /** Validation issues grouped by field name, from either submission path. */
  issues: EndpointRef<Record<string, readonly EndpointFormIssue[]>>
  allIssues: EndpointRef<readonly EndpointFormIssue[]>
}

type EndpointRawCallFeature<
  ROUTE extends EndpointRouteEntry,
  FEATURES extends EndpointClientFeatureOptions,
> = FEATURES['raw'] extends true
  ? {
      raw: () => Promise<EndpointRawResponse<ROUTE>>
    }
  : {}

type EndpointContractResult<ROUTE extends EndpointRouteEntry> =
  HasEndpointResponses<ROUTE['definition']> extends true
    ? EndpointResultValue<NormalizeResponses<ROUTE['definition']>>
    : InferredEndpointResultValue<RouteHandlerReturn<ROUTE>>

type EndpointContractResultData<ROUTE extends EndpointRouteEntry> =
  HasEndpointResponses<ROUTE['definition']> extends true
    ? EndpointResultDataValue<NormalizeResponses<ROUTE['definition']>>
    : InferredEndpointResultDataValue<RouteHandlerReturn<ROUTE>>

type EndpointContractRawResponse<ROUTE extends EndpointRouteEntry> =
  HasEndpointResponses<ROUTE['definition']> extends true
    ? EndpointRawResponseValue<NormalizeResponses<ROUTE['definition']>>
    : InferredEndpointRawResponseValue<RouteHandlerReturn<ROUTE>>

type ServerResponsesForRoute<ROUTE extends EndpointRouteEntry> = ROUTE extends {
  serverResponses: infer RESPONSES extends EndpointResponsesContract
}
  ? RESPONSES
  : {}

type ServerResultForRoute<ROUTE extends EndpointRouteEntry> = [
  keyof ServerResponsesForRoute<ROUTE>,
] extends [never]
  ? never
  : {
      [STATUS in keyof ServerResponsesForRoute<ROUTE>]: StatusNumber<STATUS> extends infer STATUS_NUMBER extends
        number
        ? InferredResult<
            STATUS_NUMBER,
            IsSuccessStatus<STATUS_NUMBER>,
            ServerResponseBody<ROUTE, STATUS>,
            true
          >
        : never
    }[keyof ServerResponsesForRoute<ROUTE>]

type ServerResultDataForRoute<ROUTE extends EndpointRouteEntry> = [
  keyof ServerResponsesForRoute<ROUTE>,
] extends [never]
  ? never
  : {
      [STATUS in keyof ServerResponsesForRoute<ROUTE>]: StatusNumber<STATUS> extends infer STATUS_NUMBER extends
        number
        ? InferredResult<
            STATUS_NUMBER,
            IsSuccessStatus<STATUS_NUMBER>,
            ServerResponseBody<ROUTE, STATUS>,
            false
          >
        : never
    }[keyof ServerResponsesForRoute<ROUTE>]

type ServerRawResponseForRoute<ROUTE extends EndpointRouteEntry> = [
  keyof ServerResponsesForRoute<ROUTE>,
] extends [never]
  ? never
  : {
      [STATUS in keyof ServerResponsesForRoute<ROUTE>]: StatusNumber<STATUS> extends infer STATUS_NUMBER extends
        number
        ? TypedRawResponse<
            STATUS_NUMBER,
            IsSuccessStatus<STATUS_NUMBER>,
            ServerResponseBody<ROUTE, STATUS>
          >
        : never
    }[keyof ServerResponsesForRoute<ROUTE>]

type ServerResponseBody<ROUTE extends EndpointRouteEntry, STATUS> =
  HasMediaResponseContract<NormalizeResponses<ROUTE['definition']>> extends true
    ? EndpointMediaResponseStream
    : HasMediaResponseContract<ServerResponsesForRoute<ROUTE>> extends true
      ? EndpointMediaResponseStream
      : STATUS extends keyof ServerResponsesForRoute<ROUTE>
        ? EndpointWireValue<ResponseBody<ServerResponsesForRoute<ROUTE>[STATUS]>>
        : never

export type EndpointRequestValidationIssue = {
  path?: (string | number)[]
  message: string
  code?: string
}

export type EndpointRequestValidationProblem = {
  statusCode: 400
  statusMessage: 'Validation Error'
  data: Partial<Record<'params' | 'query' | 'headers' | 'body', EndpointRequestValidationIssue[]>>
}

export type EndpointMediaTypeProblem<STATUS extends 406 | 415> = {
  statusCode: STATUS
  statusMessage: STATUS extends 406 ? 'Not Acceptable' : 'Unsupported Media Type'
  data: {
    message: string
    received: string | null
    supportedMediaTypes: string[]
  }
}

export type EndpointIdempotencyProblem<STATUS extends 400 | 409 | 422> = {
  type: 'about:blank'
  title: string
  status: STATUS
  detail: string
  code: STATUS extends 400
    ? 'IDEMPOTENCY_KEY_REQUIRED' | 'IDEMPOTENCY_KEY_INVALID'
    : STATUS extends 409
      ? 'IDEMPOTENCY_REQUEST_IN_FLIGHT' | 'IDEMPOTENCY_LEASE_LOST'
      : 'IDEMPOTENCY_KEY_REUSED'
}

type HasRequestValidation<DEFINITION extends EndpointDefinition> = DEFINITION extends
  | { params: unknown }
  | { query: unknown }
  | { headers: unknown }
  | { body: unknown }
  ? true
  : false

type HasMediaTypeRequest<DEFINITION extends EndpointDefinition> = DEFINITION extends {
  body: infer BODY
}
  ? IsEndpointBodyMediaTypeMap<BODY> extends true
    ? true
    : false
  : false

type IsUnion<VALUE, WHOLE = VALUE> = [VALUE] extends [never]
  ? false
  : VALUE extends WHOLE
    ? [WHOLE] extends [VALUE]
      ? false
      : true
    : false

type HasResponseNegotiation<DEFINITION extends EndpointDefinition> =
  true extends IsUnion<ResponseMediaTypes<DEFINITION>> ? true : false

type HasIdempotency<DEFINITION extends EndpointDefinition> = DEFINITION extends {
  idempotency: { enabled: true }
}
  ? true
  : false

type FrameworkClientBody<DEFINITION extends EndpointDefinition, BODY> =
  HasMediaResponseContract<NormalizeResponses<DEFINITION>> extends true
    ? EndpointMediaResponseStream
    : EndpointWireValue<BODY>

type EndpointFrameworkResult<ROUTE extends EndpointRouteEntry, WITH_HEADERS extends boolean> =
  | (HasRequestValidation<ROUTE['definition']> extends true
      ? InferredResult<
          400,
          false,
          FrameworkClientBody<ROUTE['definition'], EndpointRequestValidationProblem>,
          WITH_HEADERS
        >
      : never)
  | (HasMediaTypeRequest<ROUTE['definition']> extends true
      ? InferredResult<
          415,
          false,
          FrameworkClientBody<ROUTE['definition'], EndpointMediaTypeProblem<415>>,
          WITH_HEADERS
        >
      : never)
  | (HasResponseNegotiation<ROUTE['definition']> extends true
      ? InferredResult<
          406,
          false,
          FrameworkClientBody<ROUTE['definition'], EndpointMediaTypeProblem<406>>,
          WITH_HEADERS
        >
      : never)
  | (HasIdempotency<ROUTE['definition']> extends true
      ? {
          [STATUS in 400 | 409 | 422]: InferredResult<
            STATUS,
            false,
            FrameworkClientBody<ROUTE['definition'], EndpointIdempotencyProblem<STATUS>>,
            WITH_HEADERS
          >
        }[400 | 409 | 422]
      : never)

export type EndpointResult<ROUTE extends EndpointRouteEntry> =
  | EndpointContractResult<ROUTE>
  | ServerResultForRoute<ROUTE>
  | EndpointFrameworkResult<ROUTE, true>

export type EndpointResultData<ROUTE extends EndpointRouteEntry> =
  | EndpointContractResultData<ROUTE>
  | ServerResultDataForRoute<ROUTE>
  | EndpointFrameworkResult<ROUTE, false>

export type EndpointRawResponse<ROUTE extends EndpointRouteEntry> =
  | EndpointContractRawResponse<ROUTE>
  | ServerRawResponseForRoute<ROUTE>
  | FrameworkRawResponseForRoute<ROUTE>

type FrameworkRawResponseForRoute<ROUTE extends EndpointRouteEntry> =
  EndpointFrameworkResult<ROUTE, false> extends infer RESULT
    ? RESULT extends { status: infer STATUS extends number; body: infer BODY }
      ? TypedRawResponse<STATUS, false, BODY>
      : never
    : never

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

export type EndpointClientRuntimeOptions = {
  features?: Partial<EndpointClientFeatureOptions>
  fetcher?: EndpointFetcherRuntime
  /**
   * Resolves the request-aware fetcher for the current SSR request, so a
   * composable forwards the incoming cookies and headers to the internal
   * route the way `useFetch` does. Called per composable call rather than
   * once at module scope, because the fetcher belongs to the request.
   *
   * `useEndpoint` uses it for its request. `$endpoint` keeps direct awaits on
   * plain `$fetch`, but the Pinia Colada adapters use the captured fetcher so
   * SSR forwards the incoming request.
   */
  captureFetcher?: () => EndpointFetcherRuntime | undefined
}

/**
 * The reactivity and navigation primitives `useEndpointForm` needs.
 *
 * Injected the way `captureFetcher` is, so this module's client stays free of
 * any import from Vue or Nuxt. Everything except the two reactive pieces is
 * optional: without a Nuxt request context there is simply no native
 * submission to restore, which is the same graceful degradation
 * `captureFetcher` already has.
 */
export type EndpointFormBindings = {
  ref: <VALUE>(value: VALUE) => { value: VALUE }
  computed: <VALUE>(getter: () => VALUE) => { readonly value: VALUE }
  /** Carries a native submission's result across hydration. */
  useState?: <VALUE>(key: string, init: () => VALUE) => { value: VALUE }
  /** The request being rendered, when one exists. */
  useRequestEvent?: () => { context?: Record<string, unknown> } | undefined
  navigateTo?: (to: string) => unknown
  /** Lets a GET form load its query endpoint during SSR and native navigation. */
  useEndpoint?: UseEndpointClientRuntimeValue
}

/** What the bridge leaves on the event for the page that renders the failure. */
export type EndpointNativeSubmission = {
  /**
   * The endpoint the submission was forwarded to. A page may project more
   * than one endpoint into a form, and only the one that was actually posted
   * to should redisplay a rejection.
   */
  route: { method: string; path: string }
  status: number
  issues: readonly EndpointFormIssue[]
  values: Record<string, string>
}

export { endpointNativeSubmissionKey }

export type EndpointCallRuntime = {
  result: () => Promise<EndpointResultRuntime>
  raw: () => Promise<Response>
  request: EndpointRequestFunctions
  queryOptions?: () => EndpointCallQueryOptionsRuntime
  mutationOptions?: () => EndpointCallMutationOptionsRuntime
  infiniteQueryOptions?: () => EndpointCallInfiniteQueryOptionsRuntime
}

type EndpointCallQueryOptionsRuntime = {
  key: EndpointCacheKey
  query: (context: { signal: AbortSignal }) => Promise<EndpointResultDataRuntime>
}

type EndpointCallMutationOptionsRuntime = {
  key: EndpointCacheKey
  mutation: () => Promise<EndpointResultDataRuntime>
}

export type EndpointCallInfiniteQueryOptionsRuntime = {
  key: EndpointCacheKey
  initialPageParam: undefined
  query: (context: {
    signal: AbortSignal
    pageParam: string | undefined
  }) => Promise<Record<string, unknown>>
  getNextPageParam: (lastPage: Record<string, unknown>) => string | undefined
}

export type EndpointRequestRuntime<VALUE> = (signal?: AbortSignal) => Promise<VALUE>

export type EndpointRequestFunctions = {
  result: EndpointRequestRuntime<EndpointResultRuntime>
  raw: EndpointRequestRuntime<Response>
  options: Record<string, unknown>
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
  name?: string
  path: string
  method: HttpMethod
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
  /**
   * Set when the route declares `form`. Resolved at build time, so what
   * arrives here is the page URL, the encoding, and plain HTML attributes -
   * never a schema object.
   */
  form?: {
    from: string
    method: 'get' | 'post'
    redirect?: string
    enctype: string
    fields: Record<string, Record<string, unknown>>
  }
  pagination?: {
    kind: 'cursor'
    status: 200
    cursor: 'cursor'
    limit: 'limit'
    items: 'items'
    next: 'nextCursor'
  }
}

export type EndpointClientRouteConfigInput = readonly EndpointClientRouteConfig[]

export type EndpointClientRuntimeValue = (
  request: string,
  options?: Record<string, unknown>,
) => EndpointCallRuntimeValue

export type UseEndpointClientRuntimeValue = (
  path: string,
  options?: Record<string, unknown>,
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
  const fetcher = options.fetcher
  const client = ((request: string, callOptions = {}) => {
    const { route, endpointOptions } = resolveEndpointRoute(routes, request, callOptions)
    const queryFetcher = fetcher ?? options.captureFetcher?.()
    return createEndpointCall(route, endpointOptions, features, fetcher, queryFetcher)
  }) as EndpointClientRuntimeValue

  attachEndpointNames(client, routes)

  return client
}

function attachEndpointNames(
  client: EndpointClientRuntimeValue,
  routes: EndpointClientRouteConfig[],
): void {
  const names = new Set<string>()
  for (const route of routes) {
    if (route.name === undefined) continue
    if (!isValidEndpointName(route.name)) {
      throw new TypeError(`Endpoint name must be a valid JavaScript identifier: ${route.name}`)
    }
    if (isReservedEndpointName(route.name)) {
      throw new TypeError(`Endpoint name is reserved by $endpoint: ${route.name}`)
    }
    if (names.has(route.name)) {
      throw new TypeError(`Duplicate endpoint name: ${route.name}`)
    }
    names.add(route.name)
    Object.defineProperty(client, route.name, {
      configurable: false,
      enumerable: true,
      value(callOptions: Record<string, unknown> = {}) {
        return client(route.path, { ...callOptions, method: route.method })
      },
    })
  }
}

/**
 * Builds `useEndpointForm`, next to `useEndpoint`.
 *
 * A form projection is not a request variant, so it does not hang off a request
 * object: it needs component-scoped reactivity and the current request's
 * context, which is what makes it a composable rather than a plain adapter
 * like `queryOptions(request)`.
 *
 * The reactivity and navigation it needs are injected, the way `captureFetcher`
 * is, so this runtime imports nothing from Vue or Nuxt.
 */
export function createUseEndpointForm(
  routesInput: EndpointClientRouteConfigInput,
  bindings: EndpointFormBindings,
  options: EndpointClientRuntimeOptions = {},
) {
  const routes = normalizeRoutes(routesInput)
  const client = ((path: string, callOptions = {}) => {
    const { onSuccess, validation, resolveMessage, ...requestOptions } = callOptions as Record<
      string,
      unknown
    >
    if (validation !== undefined && validation !== 'browser' && validation !== 'server') {
      throw new TypeError(
        `[nuxt-endpoints] useEndpointForm validation must be "browser" or "server". Received ${JSON.stringify(validation)}.`,
      )
    }
    if (resolveMessage !== undefined && typeof resolveMessage !== 'function') {
      throw new TypeError('[nuxt-endpoints] useEndpointForm resolveMessage must be a function.')
    }
    const { route, endpointOptions } = resolveEndpointRoute(routes, path, requestOptions)
    if (!route.form) {
      throw new Error(
        `[nuxt-endpoints] ${route.method.toUpperCase()} ${route.path} does not declare \`form\`, so it has no native-form projection. Add \`form: { from: '<page path>' }\` to its contract.`,
      )
    }
    if (route.form.method !== route.method) {
      throw new Error(
        `[nuxt-endpoints] Stale form metadata: ${route.form.method.toUpperCase()} form cannot invoke ${route.method.toUpperCase()} ${route.path}. Rebuild the generated endpoint client.`,
      )
    }
    const fetcher = options.fetcher ?? options.captureFetcher?.()
    const queryState =
      route.form.method === 'get' && bindings.useEndpoint
        ? (bindings.useEndpoint(path, {
            ...endpointOptions,
            method: route.method,
          }) as EndpointFormQueryState)
        : undefined
    return createEndpointFormCall(
      route,
      endpointOptions,
      bindings,
      {
        ...(typeof onSuccess === 'function' ? { onSuccess } : {}),
        ...(validation ? { validation } : {}),
        ...(resolveMessage ? { resolveMessage } : {}),
      } as EndpointFormCallRuntimeOptions,
      fetcher,
      queryState,
    )
  }) as UseEndpointFormClientRuntimeValue

  return client
}

export type UseEndpointFormClientRuntimeValue = (
  path: string,
  options?: Record<string, unknown>,
) => unknown

export function createUseEndpoint(
  routesInput: EndpointClientRouteConfigInput,
  useAsyncData: UseAsyncDataRuntime,
  options: EndpointClientRuntimeOptions = {},
) {
  const features = resolveClientFeatures(options.features)
  const routes = normalizeRoutes(routesInput)
  const client = ((request: string, callOptions = {}) => {
    const { route, endpointOptions } = resolveEndpointRoute(routes, request, callOptions)
    const fetcher = options.fetcher ?? options.captureFetcher?.()
    return createUseEndpointCall(route, endpointOptions, useAsyncData, features, fetcher)
  }) as UseEndpointClientRuntimeValue

  return client
}

export type EndpointCallRuntimeValue = PromiseLike<unknown> &
  Pick<Promise<unknown>, 'catch' | 'finally'> & {
    raw: () => Promise<Response>
    [endpointCallRuntimeSymbol]: EndpointCallRuntime
    [key: string]: unknown
  }

type QueryEndpointRoute = EndpointRouteEntry & { method: 'get' | 'head' }
type MutationEndpointRoute = EndpointRouteEntry & {
  method: 'delete' | 'patch' | 'post' | 'put'
}
/** Converts a GET/HEAD endpoint request into standard Pinia Colada query options. */
export function queryOptions<
  const ROUTE extends QueryEndpointRoute,
  FEATURES extends EndpointClientFeatureOptions,
>(request: EndpointCall<ROUTE, FEATURES>): EndpointCallQueryOptions<ROUTE>
export function queryOptions(request: EndpointCallRuntimeValue): EndpointCallQueryOptionsRuntime
export function queryOptions(request: unknown): EndpointCallQueryOptionsRuntime {
  const options = endpointCallRuntime(request).queryOptions
  if (!options) {
    throw new TypeError(
      '[nuxt-endpoints] queryOptions() only accepts a GET or HEAD endpoint request.',
    )
  }
  return options()
}

/** Converts an unsafe-method endpoint request into standard Pinia Colada mutation options. */
export function mutationOptions<
  const ROUTE extends MutationEndpointRoute,
  FEATURES extends EndpointClientFeatureOptions,
>(request: EndpointCall<ROUTE, FEATURES>): EndpointCallMutationOptions<ROUTE>
export function mutationOptions(
  request: EndpointCallRuntimeValue,
): EndpointCallMutationOptionsRuntime
export function mutationOptions(request: unknown): EndpointCallMutationOptionsRuntime {
  const options = endpointCallRuntime(request).mutationOptions
  if (!options) {
    throw new TypeError(
      '[nuxt-endpoints] mutationOptions() only accepts a POST, PUT, PATCH, or DELETE endpoint request.',
    )
  }
  return options()
}

/** Runtime projection used by the capability-typed Colada adapter. */
export function createEndpointInfiniteQueryOptions(
  request: unknown,
): EndpointCallInfiniteQueryOptionsRuntime {
  const options = endpointCallRuntime(request).infiniteQueryOptions
  if (!options) {
    throw new TypeError(
      '[nuxt-endpoints] infiniteQueryOptions() only accepts a GET endpoint declaring cursor pagination.',
    )
  }
  return options()
}

function endpointCallRuntime(request: unknown): EndpointCallRuntime {
  if (
    (typeof request !== 'object' && typeof request !== 'function') ||
    request === null ||
    !(endpointCallRuntimeSymbol in request)
  ) {
    throw new TypeError(
      '[nuxt-endpoints] Colada options require the request object returned by $endpoint().',
    )
  }
  return (request as EndpointCallRuntimeValue)[endpointCallRuntimeSymbol]
}

export function normalizeRoutes(
  routesInput: EndpointClientRouteConfigInput,
): EndpointClientRouteConfig[] {
  return [...routesInput]
}

function resolveEndpointRoute(
  routes: EndpointClientRouteConfig[],
  request: string,
  options: Record<string, unknown>,
) {
  const { method, ...endpointOptions } = options

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
  const resolvedOptions = resolveIdempotencyClientOptions(route, options)
  const { params, idempotencyKey, mediaType, accept, ...fetchOptions } = resolvedOptions
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

  return { result, raw, options: resolvedOptions }
}

function resolveIdempotencyClientOptions(
  route: EndpointClientRouteConfig,
  options: Record<string, unknown>,
): Record<string, unknown> {
  const metadata = route.idempotency
  const key = options.idempotencyKey
  if (!metadata || (key === undefined && !metadata.required)) {
    return options
  }
  if (key === true || key === undefined) {
    return { ...options, idempotencyKey: createIdempotencyKey() }
  }
  return options
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

function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Automatic idempotency keys require crypto.randomUUID()')
  }
  return globalThis.crypto.randomUUID()
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
  fetcher?: EndpointFetcherRuntime,
  queryFetcher: EndpointFetcherRuntime | undefined = fetcher,
): EndpointCallRuntimeValue {
  let resultPromise: Promise<EndpointResultRuntime> | undefined
  let rawPromise: Promise<Response> | undefined

  const request = createEndpointRequest(route, options, { fetcher })
  const queryRequest =
    queryFetcher === fetcher
      ? request
      : createEndpointRequest(route, request.options, { fetcher: queryFetcher })

  const result = () => {
    resultPromise ||= request.result()

    return resultPromise
  }

  const raw = () => {
    rawPromise ||= request.raw()

    return rawPromise
  }

  const callRuntime: EndpointCallRuntime = {
    result,
    raw,
    request,
    ...(route.method === 'get' || route.method === 'head'
      ? {
          queryOptions: () => ({
            key: createRequestQueryKey(route, request.options),
            query: ({ signal }: { signal: AbortSignal }) =>
              queryRequest.result(signal).then(toEndpointResultData),
          }),
        }
      : {}),
    ...(['delete', 'patch', 'post', 'put'].includes(route.method)
      ? {
          mutationOptions: () => ({
            key: createRequestQueryKey(route, request.options),
            mutation: () => queryRequest.result().then(toEndpointResultData),
          }),
        }
      : {}),
    ...(route.method === 'get' && route.pagination
      ? {
          infiniteQueryOptions: () =>
            createInfiniteQueryOptions(route, request.options, features, queryFetcher),
        }
      : {}),
  }

  const call = {
    // oxlint-disable-next-line unicorn/no-thenable -- Endpoint calls intentionally behave like ky-style Promise-like requests.
    then(
      onfulfilled: Parameters<Promise<unknown>['then']>[0],
      onrejected: Parameters<Promise<unknown>['then']>[1],
    ) {
      return result().then(onfulfilled, onrejected)
    },
    catch(onrejected: Parameters<Promise<unknown>['catch']>[0]) {
      return result().catch(onrejected)
    },
    finally(onfinally: Parameters<Promise<unknown>['finally']>[0]) {
      return result().finally(onfinally)
    },
  } as unknown as EndpointCallRuntimeValue
  call[endpointCallRuntimeSymbol] = callRuntime

  if (features.raw) {
    call.raw = raw
  }
  return call
}

function createInfiniteQueryOptions(
  route: EndpointClientRouteConfig,
  baseOptions: Record<string, unknown>,
  features: EndpointClientFeatureOptions,
  fetcher: EndpointFetcherRuntime | undefined,
): EndpointCallInfiniteQueryOptionsRuntime {
  const pagination = route.pagination!
  const optionsWithoutCursor = withPaginationCursor(baseOptions, pagination.cursor, undefined)
  return {
    key: createRequestQueryKey(route, optionsWithoutCursor),
    initialPageParam: undefined,
    query: async ({ signal, pageParam }) => {
      const options = withPaginationCursor(baseOptions, pagination.cursor, pageParam)
      const call = createEndpointCall(route, options, features, fetcher, fetcher)
      let result: EndpointResultRuntime
      try {
        result = await call[endpointCallRuntimeSymbol].request.result(signal)
      } catch (cause) {
        // Colada recognizes cancellation by the original aborted rejection.
        if (signal.aborted) throw cause
        throw new EndpointPaginationError(
          '[nuxt-endpoints] Paginated request failed before receiving an HTTP result.',
          { cause },
        )
      }
      if (result.status !== pagination.status || !result.ok) {
        throw new EndpointPaginationError(
          `[nuxt-endpoints] Paginated request expected status ${pagination.status}, received ${result.status}.`,
          { result: toEndpointResultData(result) },
        )
      }
      if (typeof result.body !== 'object' || result.body === null || Array.isArray(result.body)) {
        throw new EndpointPaginationError(
          '[nuxt-endpoints] Paginated response body must be an object.',
        )
      }
      return result.body as Record<string, unknown>
    },
    getNextPageParam: (lastPage) => {
      const next = lastPage[pagination.next]
      if (next === undefined) return undefined
      if (typeof next !== 'string') {
        throw new EndpointPaginationError(
          '[nuxt-endpoints] Paginated response nextCursor must be a string.',
        )
      }
      return next
    },
  }
}

function withPaginationCursor(
  options: Record<string, unknown>,
  cursorName: string,
  cursor: string | undefined,
): Record<string, unknown> {
  const current = options.query
  if (
    current !== undefined &&
    (typeof current !== 'object' || current === null || Array.isArray(current))
  ) {
    throw new TypeError('[nuxt-endpoints] Paginated endpoint query must be an object.')
  }
  const query = { ...((current ?? {}) as Record<string, unknown>) }
  if (cursor === undefined) delete query[cursorName]
  else query[cursorName] = cursor
  return { ...options, query }
}

function createRequestQueryKey(
  route: EndpointClientRouteConfig,
  options: Record<string, unknown>,
): EndpointCacheKey {
  const request: Record<string, unknown> = {}
  for (const key of ['params', 'query', 'body', 'mediaType', 'accept', 'idempotencyKey'] as const) {
    if (options[key] !== undefined) {
      request[key] = options[key]
    }
  }
  return ['nuxt-endpoints', 'v2', route.method, route.path, stableStringify(request)]
}

function createUseEndpointCall(
  route: EndpointClientRouteConfig,
  options: Record<string, unknown>,
  useAsyncData: UseAsyncDataRuntime,
  features: EndpointClientFeatureOptions,
  fetcher: EndpointFetcherRuntime | undefined,
) {
  const { endpointOptions, asyncDataOptions, key } = splitUseEndpointOptions(route, options)
  const call = createEndpointCall(route, endpointOptions, features, fetcher)
  const runtime = call[endpointCallRuntimeSymbol]

  return useAsyncData(
    key,
    (_nuxtApp, options) => {
      return runtime.request.result(options?.signal).then(toEndpointResultData)
    },
    asyncDataOptions,
  )
}

function splitUseEndpointOptions(
  route: EndpointClientRouteConfig,
  options: Record<string, unknown>,
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
        : createUseEndpointKey(route, endpointOptions),
  }
}

function compactOptions(options: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined))
}

function createUseEndpointKey(
  route: EndpointClientRouteConfig,
  endpointOptions: Record<string, unknown>,
): string {
  const requestKey = stableStringify(endpointOptions)
  const suffix = requestKey ? `:${requestKey}` : ''
  return `$endpoint:${route.method}:${route.path}${suffix}`
}

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

export type EndpointFormCallOptions<ROUTE extends EndpointRouteEntry = EndpointRouteEntry> = {
  /** Replaces navigating to the declared target after a successful submission. */
  onSuccess?: (result: Extract<EndpointResultData<ROUTE>, { ok: true }>) => unknown
  /**
   * `browser` keeps generated HTML constraints active. `server` adds
   * `novalidate`, so every displayed issue comes from the endpoint contract.
   * Server validation always runs in either mode.
   *
   * @default 'browser'
   */
  validation?: EndpointFormValidationMode
  /** Maps a server issue to presentation text on both SSR and enhanced paths. */
  resolveMessage?: (issue: Readonly<EndpointFormIssue>) => string
}

export type EndpointFormValidationMode = 'browser' | 'server'

/** The complete server validation issue returned by the validator. */
export type EndpointFormIssue = FormValidationIssue

/**
 * What `EndpointFormCallOptions` looks like once the contract is erased. The
 * runtime below builds one call for every route, so it works in these terms
 * and the generated types narrow them at the call site.
 */
type EndpointFormCallRuntimeOptions = {
  onSuccess?: (result: EndpointResultDataRuntime) => unknown
  validation?: EndpointFormValidationMode
  resolveMessage?: (issue: Readonly<EndpointFormIssue>) => string
}

type EndpointFormQueryState = {
  data: EndpointRef<EndpointResultDataRuntime | undefined>
  pending: EndpointRef<boolean>
}

/**
 * Projects a request into what a `<form>` needs, next to the Pinia Colada
 * `queryOptions()` and `mutationOptions()` adapters.
 *
 * The body the request was constructed with is the form's initial value, which
 * is why this can hang off a request object at all: a form's real body does not
 * exist until it is submitted.
 *
 * Each submission builds a *fresh* request, so an idempotent route gets a new
 * key per submission - one submission is one logical mutation, the same rule
 * `mutationOptions()` applies to one request object.
 */
function createEndpointFormCall(
  route: EndpointClientRouteConfig,
  options: Record<string, unknown>,
  bindings: EndpointFormBindings,
  formOptions: EndpointFormCallRuntimeOptions,
  fetcher?: EndpointFetcherRuntime,
  queryState?: EndpointFormQueryState,
) {
  const form = route.form!
  const pending = queryState?.pending ?? bindings.ref(false)
  const result = queryState?.data ?? bindings.ref<EndpointResultDataRuntime | undefined>(undefined)
  const submitted = readNativeSubmission(route, bindings)
  const values = bindings.ref<Record<string, string>>(
    initialFieldValues(form.fields, options, submitted, form.method),
  )

  const submit = async (input: unknown): Promise<EndpointResultDataRuntime> => {
    pending.value = true
    try {
      const submissionOptions =
        form.method === 'get'
          ? { ...options, query: queryFromFormEncoding(input) }
          : { ...options, body: input, mediaType: form.enctype }
      const request = createEndpointRequest(route, submissionOptions, { fetcher })
      const value = toEndpointResultData(await request.result())
      result.value = value
      return value
    } finally {
      pending.value = false
    }
  }

  const enhance = async (event: { preventDefault: () => void; target: unknown }): Promise<void> => {
    if (form.method === 'get' && !bindings.navigateTo) {
      // Preserve the native GET navigation when no router integration exists.
      return
    }
    event.preventDefault()
    const element = event.target as HTMLFormElement
    const encoded = toDeclaredEncoding(new FormData(element), form.enctype)
    if (form.method === 'get') {
      await bindings.navigateTo?.(getFormNavigationTarget(form.from, encoded))
    }
    const value = await submit(encoded)
    if (value.ok && formOptions.onSuccess) {
      formOptions.onSuccess(value)
      return
    }
    const target = resolveFormRedirect(form.redirect, value)
    if (target && bindings.navigateTo) {
      bindings.navigateTo(target)
    }
  }

  const status = bindings.computed<number | undefined>(
    () => result.value?.status ?? submitted?.status,
  )

  const issueList = bindings.computed<EndpointFormIssue[]>(() =>
    resolveFormIssueMessages(
      result.value ? collectResultIssues(result.value) : [...(submitted?.issues ?? [])],
      formOptions.resolveMessage,
    ),
  )

  return {
    attrs: {
      action: form.from,
      method: form.method,
      enctype: form.enctype,
      ...(formOptions.validation === 'server' ? { novalidate: true as const } : {}),
    },
    fields: createFieldBindings(form.fields, values),
    values,
    submit,
    enhance,
    pending,
    result,
    status,
    allIssues: issueList,
    issues: bindings.computed<Record<string, EndpointFormIssue[]>>(() => {
      const byField: Record<string, EndpointFormIssue[]> = {}
      for (const issue of issueList.value) {
        const field = (issue.path ?? []).map(String).join('.')
        ;(byField[field] ||= []).push(issue)
      }
      return byField
    }),
  }
}

function resolveFormIssueMessages(
  issues: readonly EndpointFormIssue[],
  resolveMessage: EndpointFormCallRuntimeOptions['resolveMessage'],
): EndpointFormIssue[] {
  if (!resolveMessage) {
    return [...issues]
  }
  return issues.map((issue) => {
    const message = resolveMessage(issue)
    if (typeof message !== 'string') {
      throw new TypeError('[nuxt-endpoints] useEndpointForm resolveMessage must return a string.')
    }
    return { ...issue, message }
  })
}

/**
 * A form can only submit the encoding it declares, so the enhanced path sends
 * the same bytes the browser would have - it never re-encodes into JSON.
 */
function toDeclaredEncoding(form: FormData, enctype: string): FormData | URLSearchParams {
  if (enctype === 'multipart/form-data') {
    return form
  }
  const encoded = new URLSearchParams()
  for (const [name, value] of form.entries()) {
    if (typeof value === 'string') {
      encoded.append(name, value)
    }
  }
  return encoded
}

function queryFromFormEncoding(input: unknown): Record<string, unknown> {
  if (!(input instanceof URLSearchParams)) {
    if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
      return input as Record<string, unknown>
    }
    throw new TypeError('[nuxt-endpoints] A GET form submission must be URLSearchParams.')
  }

  return collectRepeatedEntries(input)
}

/** Native GET form semantics: its controls replace the action URL's query. */
function getFormNavigationTarget(from: string, query: URLSearchParams | FormData): string {
  if (!(query instanceof URLSearchParams)) {
    throw new TypeError('[nuxt-endpoints] A GET form cannot navigate with multipart data.')
  }
  const encoded = query.toString()
  return `${from}${encoded ? `?${encoded}` : ''}`
}

/** `'/todos/{id}'` against the response body. */
function resolveFormRedirect(
  template: string | undefined,
  result: EndpointResultDataRuntime,
): string | undefined {
  if (!template || !result.ok) {
    return undefined
  }
  const body = (result.body ?? {}) as Record<string, unknown>
  return resolveFormRedirectTemplate(template, body)
}

/**
 * Reads what the bridge left for this render. Absent outside a Nuxt request
 * context, which is the degraded case rather than an error: everything except
 * the restored values still works.
 */
function readNativeSubmission(
  route: EndpointClientRouteConfig,
  bindings: EndpointFormBindings,
): EndpointNativeSubmission | undefined {
  const read = () => {
    try {
      const context = bindings.useRequestEvent?.()?.context as Record<string, unknown> | undefined
      const submission = context?.[endpointNativeSubmissionKey] as
        | EndpointNativeSubmission
        | undefined
      return submission?.route.method === route.method && submission.route.path === route.path
        ? submission
        : undefined
    } catch {
      return undefined
    }
  }
  if (!bindings.useState) {
    return read()
  }
  try {
    return bindings.useState(`nuxt-endpoints:form:${route.method}:${route.path}`, read).value
  } catch {
    return read()
  }
}

/**
 * The module's own validation failure carries its issues under
 * `data.<source>`. An application that replaced that shape gets an empty list
 * here and reads `result` directly instead.
 */
function collectResultIssues(result: EndpointResultDataRuntime): EndpointFormIssue[] {
  return result.ok ? [] : extractFormIssues(result.body)
}

/**
 * The value each field starts with: what a rejected native submission sent,
 * or else the request's initial body (POST) or query (GET).
 *
 * A checkbox is driven by `checked` rather than `value`, and a file cannot be
 * given one at all, so anything that is not a scalar is left to the template.
 */
function initialFieldValues(
  fields: Record<string, Record<string, unknown>>,
  options: Record<string, unknown>,
  submitted: EndpointNativeSubmission | undefined,
  method: 'get' | 'post',
): Record<string, string> {
  const initial = ((method === 'get' ? options.query : options.body) ?? {}) as Record<
    string,
    unknown
  >
  const values: Record<string, string> = {}
  for (const name of Object.keys(fields)) {
    const value = submitted ? submitted.values[name] : initial[name]
    if (typeof value === 'string' || typeof value === 'number') {
      values[name] = String(value)
    }
  }
  return values
}

/**
 * One `v-bind`-able attribute set per field, with the value bound in both
 * directions.
 *
 * `value` has to be a getter rather than a snapshot: Vue force-patches that
 * one prop on every full-props update (`v-bind="..."`), so a fixed value would
 * overwrite what the user typed the moment anything else on the page changed.
 * Binding `onInput` alongside it makes the input controlled, which is what
 * makes redisplay after a rejection work on both submission paths.
 *
 * A file input is left alone: a browser refuses to let a page set its value.
 */
function createFieldBindings(
  fields: Record<string, Record<string, unknown>>,
  values: EndpointRef<Record<string, string>>,
): Record<string, Record<string, unknown>> {
  const bound: Record<string, Record<string, unknown>> = {}
  for (const [name, attributes] of Object.entries(fields)) {
    const binding: Record<string, unknown> = { ...attributes }
    if (attributes.type !== 'file') {
      Object.defineProperty(binding, 'value', {
        enumerable: true,
        get: () => values.value[name] ?? '',
      })
      binding.onInput = (event: { target?: unknown }) => {
        const target = event.target as { value?: string } | undefined
        values.value = { ...values.value, [name]: target?.value ?? '' }
      }
    }
    bound[name] = binding
  }
  return bound
}
