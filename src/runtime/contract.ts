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

export type EndpointRequestContract = {
  params?: ValidatorSchema
  query?: ValidatorSchema
  headers?: ValidatorSchema
  body?: ValidatorSchema
}

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
  body: InferOutputOrUndefined<DEFINITION['body']>
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

type InferInputOrNever<SCHEMA> = SCHEMA extends ValidatorSchema ? InferInput<SCHEMA> : never

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
