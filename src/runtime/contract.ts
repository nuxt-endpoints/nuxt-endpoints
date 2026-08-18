import type { RuntimeEvent } from './h3-adapter'
import type { InferInput, InferOutput, ValidatorSchema } from './validator'
import type { ResponseOptions, StatusCode, StatusResponse } from './response'

export type HttpMethod =
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete'
  | 'head'
  | 'options'
  | 'connect'
  | 'trace'

// Media-type keyed request-body contract. Keys must be lowercase and are
// restricted to the media-type families the runtime can actually parse
// (see `isSupportedBodyMediaType` in body-media-type.ts).
export type EndpointBodyMediaTypeMap = {
  readonly [mediaType: string]: ValidatorSchema
}

export type EndpointRequestContract = {
  params?: ValidatorSchema
  query?: ValidatorSchema
  headers?: ValidatorSchema
  body?: ValidatorSchema | EndpointBodyMediaTypeMap
}

// Discriminates a `body` contract between a single validator schema and a
// media-type map. The schema branch is checked first: `ValidatorSchema`'s
// members each carry a structural marker (`~standard`, the Effect
// `Type`/`Encoded`/`Context`/`ast` shape, or Zod's `parse`/`safeParse`
// family), and TypeScript's "weak type" detection means a map whose keys are
// media-type strings (which never collide with those markers) fails the
// schema check outright — so checking the map shape second is unambiguous.
// Exported so the client-side task can reuse the same discrimination.
export type IsEndpointBodyMediaTypeMap<BODY> = [BODY] extends [ValidatorSchema]
  ? false
  : [BODY] extends [EndpointBodyMediaTypeMap]
    ? true
    : false

export type ResponseContract =
  | ValidatorSchema
  | {
      body: ValidatorSchema
      description?: string
      contentType?: string
      headers?: Record<string, ValidatorSchema>
    }

export type EndpointResponsesContract = Record<number | string, ResponseContract>

export type EndpointIdempotencyMetadata<
  HEADER_NAME extends string = string,
  REQUIRED extends boolean = boolean,
> = {
  enabled: true
  headerName: HEADER_NAME
  required: REQUIRED
}

export type EndpointDefinition = EndpointRequestContract & {
  operation?: string
  response?: ResponseContract
  responses?: EndpointResponsesContract
  summary?: string
  description?: string
  tags?: string[]
  idempotency?: EndpointIdempotencyMetadata
}

export type EndpointContext<DEFINITION extends EndpointDefinition> = {
  event: RuntimeEvent
  request: Request
  params: InferOutputOrUndefined<DEFINITION['params']>
  query: InferOutputOrUndefined<DEFINITION['query']>
  headers: InferOutputOrUndefined<DEFINITION['headers']>
  body: InferBodyOutputOrUndefined<DEFINITION['body']>
  /**
   * The media type whose schema matched the request when `body` is a
   * media-type map (e.g. `'application/json'`). `undefined` for a single
   * schema `body` contract or when there is no `body` contract at all.
   */
  bodyMediaType: InferBodyMediaType<DEFINITION['body']>
  respond: EndpointResponder<DEFINITION>
}

export type EndpointClientOptions<DEFINITION extends EndpointDefinition> = OptionalIfEmpty<
  RemoveNever<{
    params: InferInputOrNever<DEFINITION['params']>
    query: InferInputOrNever<DEFINITION['query']>
    headers: InferInputOrNever<DEFINITION['headers']>
    body: InferInputOrNever<DEFINITION['body']>
  }> &
    EndpointIdempotencyClientOptions<DEFINITION>
>

export type EndpointClientOptionsAreOptional<DEFINITION extends EndpointDefinition> = [
  EndpointClientOptions<DEFINITION>,
] extends [void]
  ? true
  : {} extends EndpointClientOptions<DEFINITION>
    ? true
    : false

export type EndpointSuccessBody<DEFINITION extends EndpointDefinition> = SuccessResponseBody<
  NormalizeResponses<DEFINITION>
>

export type HandlerReturn<DEFINITION extends EndpointDefinition> = [
  keyof NormalizeResponses<DEFINITION>,
] extends [never]
  ? unknown
  : DirectSuccessReturn<DEFINITION> | StatusResponseReturn<DEFINITION> | void

export type HasEndpointResponses<DEFINITION extends EndpointDefinition> = [
  keyof NormalizeResponses<DEFINITION>,
] extends [never]
  ? false
  : true

export type EndpointHandler<DEFINITION extends EndpointDefinition, ACTUAL_RETURN> = (
  context: EndpointContext<DEFINITION>,
) => ACTUAL_RETURN & Check<Awaited<ACTUAL_RETURN>, HandlerReturn<DEFINITION>>

export type EndpointResponder<DEFINITION extends EndpointDefinition> =
  HasEndpointResponses<DEFINITION> extends true
    ? DeclaredEndpointResponder<DEFINITION>
    : InferredEndpointResponder

type DeclaredEndpointResponder<DEFINITION extends EndpointDefinition> = <
  const STATUS extends EndpointResponseStatus<DEFINITION>,
>(
  status: STATUS,
  body: ResponseBodyForStatus<NormalizeResponses<DEFINITION>, STATUS>,
  options?: ResponseOptions,
) => StatusResponse<STATUS, ResponseBodyForStatus<NormalizeResponses<DEFINITION>, STATUS>>

type InferredEndpointResponder = <
  const STATUS extends StatusCode,
  const BODY,
  const HEADERS extends Record<string, string> = Record<string, string>,
>(
  status: STATUS,
  body: BODY,
  options?: ResponseOptions<HEADERS>,
) => StatusResponse<STATUS, BODY, HEADERS>

export type EndpointResponseStatus<DEFINITION extends EndpointDefinition> = StatusNumber<
  keyof NormalizeResponses<DEFINITION>
>

type Check<ACTUAL, EXPECTED> = [DeepMutable<ACTUAL>] extends [EXPECTED] ? unknown : never

export type DeepMutable<VALUE> = VALUE extends
  | Date
  | RegExp
  | Error
  | ((...args: never[]) => unknown)
  ? VALUE
  : VALUE extends ReadonlyMap<infer KEY, infer ITEM>
    ? Map<DeepMutable<KEY>, DeepMutable<ITEM>>
    : VALUE extends ReadonlySet<infer ITEM>
      ? Set<DeepMutable<ITEM>>
      : VALUE extends readonly (infer ITEM)[]
        ? DeepMutable<ITEM>[]
        : VALUE extends object
          ? { -readonly [KEY in keyof VALUE]: DeepMutable<VALUE[KEY]> }
          : VALUE

export type UnknownIfNever<VALUE> = [VALUE] extends [never] ? unknown : VALUE

export type IsSuccessStatus<STATUS extends number> = number extends STATUS
  ? boolean
  : `${STATUS}` extends `2${string}`
    ? true
    : false

type OptionalIfEmpty<T extends Record<string, unknown>> = keyof T extends never ? void : T

type RemoveNever<T extends Record<string, unknown>> = {
  [KEY in keyof T as T[KEY] extends never ? never : KEY]: T[KEY]
}

type EndpointIdempotencyClientOptions<DEFINITION extends EndpointDefinition> = DEFINITION extends {
  idempotency: { required: true }
}
  ? { idempotencyKey: string }
  : DEFINITION extends { idempotency: EndpointIdempotencyMetadata }
    ? { idempotencyKey?: string }
    : {}

type InferOutputOrUndefined<SCHEMA> = SCHEMA extends ValidatorSchema
  ? InferOutput<SCHEMA>
  : undefined

// Same as `InferOutputOrUndefined`, but for `body` specifically: a
// media-type map infers to the union of all its members' outputs.
type InferBodyOutputOrUndefined<BODY> = BODY extends ValidatorSchema
  ? InferOutput<BODY>
  : BODY extends Record<string, infer MEMBER extends ValidatorSchema>
    ? InferOutput<MEMBER>
    : undefined

// `keyof BODY` (or an indexed access like `BODY[keyof BODY]`) on a generic
// `BODY` parameter produces a deferred type that breaks `DefinedEndpoint`'s
// structural comparability across its own generic instantiations (see the
// `.idempotency()` overloads below) — so, like `InferBodyOutputOrUndefined`
// above, this infers the media-type keys instead of indexing into `BODY`.
type InferBodyMediaType<BODY> = BODY extends ValidatorSchema
  ? undefined
  : BODY extends Record<infer MEDIA_TYPE extends string, ValidatorSchema>
    ? MEDIA_TYPE
    : undefined

// Client input inference for a media-type map is handled by the client-side
// task; this only keeps a map `body` from producing a type error here by
// falling back to the `application/json` member's input (or `never` if there
// isn't one).
type InferInputOrNever<SCHEMA> = SCHEMA extends ValidatorSchema
  ? InferInput<SCHEMA>
  : SCHEMA extends { 'application/json': infer JSON_SCHEMA extends ValidatorSchema }
    ? InferInput<JSON_SCHEMA>
    : never

export type NormalizeResponses<DEFINITION extends EndpointDefinition> = DEFINITION extends {
  responses: infer RESPONSES extends EndpointResponsesContract
}
  ? RESPONSES
  : DEFINITION extends { response: infer RESPONSE extends ResponseContract }
    ? { 200: RESPONSE }
    : {}

type DirectSuccessReturn<DEFINITION extends EndpointDefinition> = ResponseBodyForStatus<
  NormalizeResponses<DEFINITION>,
  200
>

type StatusResponseReturn<DEFINITION extends EndpointDefinition> = {
  [STATUS in keyof NormalizeResponses<DEFINITION>]: StatusNumber<STATUS> extends infer STATUS_NUMBER extends
    StatusCode
    ? StatusResponse<STATUS_NUMBER, ResponseBody<NormalizeResponses<DEFINITION>[STATUS]>>
    : never
}[keyof NormalizeResponses<DEFINITION>]

export type ResponseBodyForStatus<
  RESPONSES extends EndpointResponsesContract,
  STATUS extends StatusCode,
> = {
  [KEY in keyof RESPONSES]: StatusNumber<KEY> extends STATUS ? ResponseBody<RESPONSES[KEY]> : never
}[keyof RESPONSES]

export type SuccessResponseBody<RESPONSES extends EndpointResponsesContract> = {
  [KEY in keyof RESPONSES]: `${StatusNumber<KEY>}` extends `2${string}`
    ? ResponseBody<RESPONSES[KEY]>
    : never
}[keyof RESPONSES]

export type ResponseBody<RESPONSE> = RESPONSE extends { body: infer BODY extends ValidatorSchema }
  ? InferOutput<BODY>
  : RESPONSE extends ValidatorSchema
    ? InferOutput<RESPONSE>
    : never

export type StatusNumber<STATUS> = STATUS extends number
  ? STATUS
  : STATUS extends `${infer STATUS_NUMBER extends number}`
    ? STATUS_NUMBER
    : never
