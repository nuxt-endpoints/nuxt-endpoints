import type {
  DeepReadonly,
  EndpointBodyMediaTypeMap,
  EndpointContext,
  EndpointDefinition,
  EndpointIdempotencyInput,
  EndpointResponsesContract,
  HandlerReturn,
  HasEndpointResponses,
  NormalizeEndpointIdempotencyInput,
  WidenCapturedReturn,
} from './contract'
import type { EndpointFormContract } from './contract'
import type { NativeFormProjectionConstraint } from './form-projection'
import type { IdempotencyRouteContractForbiddenOptionKey } from './idempotency'
import {
  applyCursorPaginationContract,
  type ApplyPaginationQuery,
  type ApplyPaginationResponses,
  type CursorPaginationPage,
  type EndpointCursorPaginationContract,
  type EndpointPaginationContract,
  type PaginationContractConstraint,
} from './pagination'
import type { StatusResponse } from './response'
import {
  defineEndpointHandler,
  type AssembledEndpointContract,
  DefinedEndpoint,
  type EndpointHandlerSuccessBody,
  type EndpointRuntimeOptions,
  validateEndpointDefinition,
} from './endpoint'
import { normalizeEndpointIdempotencyMetadata } from './idempotency-contract'
import { defineEndpointMethodHandlers, defineEndpointMethods } from './endpoint-methods'
import type { RuntimeEvent } from './platform'
import type { ValidatorSchema } from './validator'

type EndpointRequestInput<PARAMS, QUERY, HEADERS, BODY> = {
  params?: PARAMS
  query?: QUERY
  headers?: HEADERS
  body?: BODY
}

// The contract carries only portable metadata. Request-time settings have no
// public per-endpoint transport yet: callbacks cannot enter build evaluation,
// and accepting the serializable settings here would silently discard them.
// The shared key union also drives JavaScript definition-time validation.
type RouteContractIdempotency = {
  [KEY in IdempotencyRouteContractForbiddenOptionKey]?: never
}

type RouteContractIdempotencyInput =
  | true
  | (Exclude<EndpointIdempotencyInput, true> & RouteContractIdempotency)

type RouteContractIdempotencyConstraint<Input> = {
  idempotency?: Input extends object ? Input & RouteContractIdempotency : Input
}

export type EndpointRouteEvent<DEFINITION extends EndpointDefinition = EndpointDefinition> =
  RuntimeEvent & {
    readonly routeDef: DEFINITION
    readonly validated: Pick<EndpointContext<DEFINITION>, 'params' | 'query' | 'headers' | 'body'>
    readonly respond: EndpointContext<DEFINITION>['respond']
    readonly bodyMediaType: EndpointContext<DEFINITION>['bodyMediaType']
    readonly responseMediaType: EndpointContext<DEFINITION>['responseMediaType']
  }

type CapturedRouteHandler<DEFINITION extends EndpointDefinition, ACTUAL_RETURN> = (
  event: EndpointRouteEvent<DEFINITION>,
) => ACTUAL_RETURN | Promise<ACTUAL_RETURN>

type RouteHandlerInput<
  PARAMS,
  QUERY,
  HEADERS,
  BODY,
  RESPONSES,
  SUMMARY,
  DESCRIPTION,
  TAGS,
  IDEMPOTENCY,
  FORM,
  PAGINATION,
  DEFINITION extends EndpointDefinition,
  ACTUAL_RETURN,
> = {
  name?: string
  request?: EndpointRequestInput<PARAMS, QUERY, HEADERS, BODY>
  responses?: RESPONSES
  params?: never
  validate?: never
  response?: never
  summary?: SUMMARY
  description?: DESCRIPTION
  tags?: TAGS
  idempotency?: IDEMPOTENCY
  form?: FORM & NativeFormProjectionConstraint<FORM, QUERY, HEADERS, BODY, IDEMPOTENCY>
  pagination?: PAGINATION & PaginationContractConstraint<PAGINATION, QUERY, RESPONSES>
  handler: CapturedRouteHandler<DEFINITION, ACTUAL_RETURN>
} & RouteContractIdempotencyConstraint<IDEMPOTENCY>

type RuntimeMethodMetadata = {
  name?: string
  summary?: string
  description?: string
  tags?: string[]
  idempotency?: RouteContractIdempotencyInput
}

type RuntimeMethodRequest = EndpointRequestInput<
  never,
  ValidatorSchema,
  ValidatorSchema,
  ValidatorSchema | EndpointBodyMediaTypeMap
>

type RuntimeMethodDefinition = RuntimeMethodMetadata & {
  request?: RuntimeMethodRequest
  responses?: EndpointResponsesContract
  pagination?: EndpointPaginationContract
  handler: (event: EndpointRouteEvent<any>) => unknown
}

type RuntimeMethodsDefinition = {
  handler?: never
  name?: never
  request?: { params?: ValidatorSchema }
  responses?: never
  get?: RuntimeMethodDefinition
  post?: RuntimeMethodDefinition
  put?: RuntimeMethodDefinition
  patch?: RuntimeMethodDefinition
  delete?: RuntimeMethodDefinition
}

type RouteMethodKey = 'get' | 'post' | 'put' | 'patch' | 'delete'

type PropertyOf<Value, Key extends PropertyKey> = Value extends unknown
  ? Key extends keyof Value
    ? Value[Key]
    : undefined
  : never

type RequestPropertyOf<Value, Key extends PropertyKey> = PropertyOf<
  PropertyOf<Value, 'request'>,
  Key
>

type PaginationOf<Value> = Value extends {
  pagination: infer PAGINATION extends EndpointPaginationContract
}
  ? PAGINATION
  : undefined

type EndpointDefinitionOf<Method, Params> = {
  name: PropertyOf<Method, 'name'>
  params: Params
  query: ApplyPaginationQuery<RequestPropertyOf<Method, 'query'>, PaginationOf<Method>>
  headers: RequestPropertyOf<Method, 'headers'>
  body: RequestPropertyOf<Method, 'body'>
  responses: ApplyPaginationResponses<PropertyOf<Method, 'responses'>, PaginationOf<Method>>
  summary: PropertyOf<Method, 'summary'>
  description: PropertyOf<Method, 'description'>
  tags: PropertyOf<Method, 'tags'>
  idempotency: NormalizeEndpointIdempotencyInput<PropertyOf<Method, 'idempotency'>>
  form: PropertyOf<Method, 'form'>
  pagination: PaginationOf<Method>
}

type RouteMethodKeys<Definition> = Extract<keyof Definition, RouteMethodKey>

type ResolvedEndpointDefinition<Definition, Method extends RouteMethodKeys<Definition>> =
  EndpointDefinitionOf<
    Definition[Method],
    RequestPropertyOf<Definition, 'params'>
  > extends infer MethodDefinition extends EndpointDefinition
    ? MethodDefinition
    : never

type ResolvedRuntimeMethodDefinition<
  Params extends ValidatorSchema | undefined,
  Metadata extends RuntimeMethodMetadata,
  Request extends RuntimeMethodRequest,
  Responses extends EndpointResponsesContract | undefined,
  Pagination extends EndpointPaginationContract | undefined = undefined,
> = {
  name: PropertyOf<Metadata, 'name'>
  params: Params
  query: ApplyPaginationQuery<PropertyOf<Request, 'query'>, Pagination>
  headers: PropertyOf<Request, 'headers'>
  body: PropertyOf<Request, 'body'>
  responses: ApplyPaginationResponses<Responses, Pagination>
  summary: PropertyOf<Metadata, 'summary'>
  description: PropertyOf<Metadata, 'description'>
  tags: PropertyOf<Metadata, 'tags'>
  idempotency: NormalizeEndpointIdempotencyInput<PropertyOf<Metadata, 'idempotency'>>
  pagination: Pagination
}

type InferredRuntimeMethod<
  Params extends ValidatorSchema | undefined,
  Metadata extends RuntimeMethodMetadata,
  Request extends RuntimeMethodRequest,
  Responses extends EndpointResponsesContract | undefined,
  ActualReturn,
  Pagination extends EndpointPaginationContract | undefined = undefined,
> = Metadata & {
  request?: Request
  responses?: Responses
  params?: never
  validate?: never
  response?: never
  pagination?: Pagination &
    PaginationContractConstraint<Pagination, PropertyOf<Request, 'query'>, Responses>
  handler: CapturedRouteHandler<
    ResolvedRuntimeMethodDefinition<Params, Metadata, Request, Responses, Pagination>,
    ActualReturn
  >
}

type RouteMethodHandlerReturns<Definition> = {
  -readonly [Method in RouteMethodKeys<Definition>]-?: HandlerReturnOf<Definition[Method]>
}

type HandlerReturnOf<Value> = Value extends { handler: (...args: never[]) => infer Return }
  ? Awaited<Return>
  : never

type RouteMethodSuccessBody<Definition> = {
  [Method in RouteMethodKeys<Definition>]: EndpointHandlerSuccessBody<
    ResolvedEndpointDefinition<Definition, Method>,
    RouteMethodHandlerReturns<Definition>[Method]
  >
}[RouteMethodKeys<Definition>]

type NormalizeRouteAuthoringDefinition<Definition> = Omit<Definition, 'idempotency'> & {
  idempotency: NormalizeEndpointIdempotencyInput<PropertyOf<Definition, 'idempotency'>>
}

type NormalizeMethodRouteAuthoringDefinition<Definition> = {
  [Key in keyof Definition]: Key extends RouteMethodKey
    ? NormalizeRouteAuthoringDefinition<Definition[Key]>
    : Definition[Key]
}

export type EndpointDefinitionFromRoute<Definition, Method extends string | undefined = undefined> =
  Method extends RouteMethodKeys<Definition>
    ? ResolvedEndpointDefinition<Definition, Method>
    : EndpointDefinitionOf<Definition, RequestPropertyOf<Definition, 'params'>>

/**
 * Cursor pagination is an NE contract constructor, so generated route types
 * overlay only the fields it creates onto the discovered base contract.
 */
export type ApplyEndpointPaginationFromRoute<
  Base extends EndpointDefinition,
  Definition,
  Method extends string | undefined = undefined,
> =
  EndpointDefinitionFromRoute<Definition, Method> extends infer Resolved extends EndpointDefinition
    ? Resolved extends { pagination: EndpointPaginationContract }
      ? Omit<Base, 'query' | 'responses' | 'pagination'> &
          Pick<Resolved, 'query' | 'responses' | 'pagination'>
      : Base
    : Base

type RawHandlerReturnFromRoute<
  Definition,
  Method extends string | undefined = undefined,
> = Method extends keyof Definition
  ? Definition[Method] extends { handler: (...args: never[]) => infer Return }
    ? Return
    : never
  : Definition extends { handler: (...args: never[]) => infer Return }
    ? Return
    : never

export type EndpointHandlerReturnFromRoute<
  Definition,
  Method extends string | undefined = undefined,
> =
  EndpointDefinitionFromRoute<Definition, Method> extends infer RouteDefinition extends
    EndpointDefinition
    ? HasEndpointResponses<RouteDefinition> extends true
      ? RawHandlerReturnFromRoute<Definition, Method>
      : WidenCapturedReturn<RawHandlerReturnFromRoute<Definition, Method>>
    : RawHandlerReturnFromRoute<Definition, Method>

type EndpointRouteEventHandler<Definition, Return> = ((event: RuntimeEvent) => Promise<Return>) & {
  readonly '~routeDef': NormalizeRouteAuthoringDefinition<Definition>
}

export type EndpointRouteMethodsEventHandler<
  Definition,
  SuccessBody = RouteMethodSuccessBody<Definition>,
> = ((event: RuntimeEvent) => Promise<SuccessBody>) & {
  readonly '~routeDef': NormalizeMethodRouteAuthoringDefinition<Definition>
}

type AssembledRouteDefinition<
  PARAMS extends ValidatorSchema | undefined,
  QUERY extends ValidatorSchema | undefined,
  HEADERS extends ValidatorSchema | undefined,
  BODY extends ValidatorSchema | EndpointBodyMediaTypeMap | undefined,
  RESPONSES extends EndpointResponsesContract | undefined,
  SUMMARY extends string | undefined,
  DESCRIPTION extends string | undefined,
  TAGS extends string[] | undefined,
  IDEMPOTENCY,
  FORM,
  PAGINATION,
> = AssembledEndpointContract<
  PARAMS,
  ApplyPaginationQuery<QUERY, PAGINATION>,
  HEADERS,
  BODY,
  ApplyPaginationResponses<RESPONSES, PAGINATION>,
  SUMMARY,
  DESCRIPTION,
  TAGS
> & {
  idempotency: NormalizeEndpointIdempotencyInput<IDEMPOTENCY>
  form: FORM
  pagination: PAGINATION
}

type CursorPaginatedRouteHandlerInput<
  PARAMS,
  QUERY,
  HEADERS,
  BODY,
  RESPONSES,
  SUMMARY,
  DESCRIPTION,
  TAGS,
  IDEMPOTENCY,
  FORM,
  ITEM extends ValidatorSchema,
  DEFINITION extends EndpointDefinition,
  ACTUAL_RETURN,
> = {
  name?: string
  request?: EndpointRequestInput<PARAMS, QUERY, HEADERS, BODY>
  responses?: RESPONSES
  params?: never
  validate?: never
  response?: never
  summary?: SUMMARY
  description?: DESCRIPTION
  tags?: TAGS
  idempotency?: IDEMPOTENCY
  form?: FORM & NativeFormProjectionConstraint<FORM, QUERY, HEADERS, BODY, IDEMPOTENCY>
  pagination: EndpointCursorPaginationContract<ITEM> &
    PaginationContractConstraint<EndpointCursorPaginationContract<ITEM>, QUERY, RESPONSES>
  handler: CapturedRouteHandler<NoInfer<DEFINITION>, ACTUAL_RETURN>
} & RouteContractIdempotencyConstraint<IDEMPOTENCY>

/**
 * Nuxt Endpoints adapter for H3's unified route-handler authoring shape.
 * Nitro treats the direct call as a compiler macro; at runtime this adapter
 * keeps only NE's application-level context, idempotency, and response policy.
 */
export function defineEndpoint<
  const PARAMS extends ValidatorSchema | undefined = undefined,
  const QUERY extends ValidatorSchema | undefined = undefined,
  const HEADERS extends ValidatorSchema | undefined = undefined,
  const BODY extends ValidatorSchema | EndpointBodyMediaTypeMap | undefined = undefined,
  const RESPONSES extends EndpointResponsesContract | undefined = undefined,
  const SUMMARY extends string | undefined = undefined,
  const DESCRIPTION extends string | undefined = undefined,
  TAGS extends string[] | undefined = undefined,
  const IDEMPOTENCY extends RouteContractIdempotencyInput | undefined = undefined,
  const FORM extends EndpointFormContract | undefined = undefined,
  const ITEM extends ValidatorSchema = ValidatorSchema,
  const ACTUAL_RETURN extends DeepReadonly<
    CursorPaginationPage<ITEM> | StatusResponse<number, unknown>
  > = DeepReadonly<CursorPaginationPage<ITEM> | StatusResponse<number, unknown>>,
  DEFINITION extends EndpointDefinition = AssembledRouteDefinition<
    PARAMS,
    QUERY,
    HEADERS,
    BODY,
    RESPONSES,
    SUMMARY,
    DESCRIPTION,
    TAGS,
    IDEMPOTENCY,
    FORM,
    EndpointCursorPaginationContract<ITEM>
  >,
>(
  definition: CursorPaginatedRouteHandlerInput<
    PARAMS,
    QUERY,
    HEADERS,
    BODY,
    RESPONSES,
    SUMMARY,
    DESCRIPTION,
    TAGS,
    IDEMPOTENCY,
    FORM,
    ITEM,
    DEFINITION,
    ACTUAL_RETURN
  >,
): EndpointRouteEventHandler<
  CursorPaginatedRouteHandlerInput<
    PARAMS,
    QUERY,
    HEADERS,
    BODY,
    RESPONSES,
    SUMMARY,
    DESCRIPTION,
    TAGS,
    IDEMPOTENCY,
    FORM,
    ITEM,
    DEFINITION,
    ACTUAL_RETURN
  >,
  CursorPaginationPage<ITEM>
>
export function defineEndpoint<
  const PARAMS extends ValidatorSchema | undefined = undefined,
  const QUERY extends ValidatorSchema | undefined = undefined,
  const HEADERS extends ValidatorSchema | undefined = undefined,
  const BODY extends ValidatorSchema | EndpointBodyMediaTypeMap | undefined = undefined,
  const RESPONSES extends EndpointResponsesContract | undefined = undefined,
  const SUMMARY extends string | undefined = undefined,
  const DESCRIPTION extends string | undefined = undefined,
  TAGS extends string[] | undefined = undefined,
  const IDEMPOTENCY extends RouteContractIdempotencyInput | undefined = undefined,
  const FORM extends EndpointFormContract | undefined = undefined,
  const PAGINATION extends EndpointPaginationContract | undefined = undefined,
  DEFINITION extends EndpointDefinition = AssembledRouteDefinition<
    PARAMS,
    QUERY,
    HEADERS,
    BODY,
    RESPONSES,
    SUMMARY,
    DESCRIPTION,
    TAGS,
    IDEMPOTENCY,
    FORM,
    PAGINATION
  >,
  const ACTUAL_RETURN extends DeepReadonly<
    HandlerReturn<
      AssembledRouteDefinition<
        PARAMS,
        QUERY,
        HEADERS,
        BODY,
        RESPONSES,
        SUMMARY,
        DESCRIPTION,
        TAGS,
        IDEMPOTENCY,
        FORM,
        PAGINATION
      >
    >
  > = DeepReadonly<
    HandlerReturn<
      AssembledRouteDefinition<
        PARAMS,
        QUERY,
        HEADERS,
        BODY,
        RESPONSES,
        SUMMARY,
        DESCRIPTION,
        TAGS,
        IDEMPOTENCY,
        FORM,
        PAGINATION
      >
    >
  >,
  const ROUTE_DEFINITION extends Record<string, unknown> & {
    idempotency?: RouteContractIdempotencyInput
  } = Record<never, never>,
>(
  definition: ROUTE_DEFINITION &
    RouteHandlerInput<
      PARAMS,
      QUERY,
      HEADERS,
      BODY,
      RESPONSES,
      SUMMARY,
      DESCRIPTION,
      TAGS,
      IDEMPOTENCY,
      FORM,
      PAGINATION,
      DEFINITION,
      ACTUAL_RETURN
    > & { pagination?: never },
): EndpointRouteEventHandler<
  ROUTE_DEFINITION &
    RouteHandlerInput<
      PARAMS,
      QUERY,
      HEADERS,
      BODY,
      RESPONSES,
      SUMMARY,
      DESCRIPTION,
      TAGS,
      IDEMPOTENCY,
      FORM,
      PAGINATION,
      DEFINITION,
      ACTUAL_RETURN
    > & {
      idempotency: NormalizeEndpointIdempotencyInput<IDEMPOTENCY>
      form: FORM
      pagination: PAGINATION
    },
  EndpointHandlerSuccessBody<
    DEFINITION,
    HasEndpointResponses<DEFINITION> extends true
      ? ACTUAL_RETURN
      : WidenCapturedReturn<ACTUAL_RETURN>
  >
>
export function defineEndpoint<
  const Params extends ValidatorSchema | undefined = undefined,
  const GetMetadata extends RuntimeMethodMetadata = Record<never, never>,
  const GetRequest extends RuntimeMethodRequest = Record<never, never>,
  const GetResponses extends EndpointResponsesContract | undefined = undefined,
  const GetPagination extends EndpointPaginationContract | undefined = undefined,
  const GetReturn extends DeepReadonly<
    HandlerReturn<
      ResolvedRuntimeMethodDefinition<Params, GetMetadata, GetRequest, GetResponses, GetPagination>
    >
  > = DeepReadonly<
    HandlerReturn<
      ResolvedRuntimeMethodDefinition<Params, GetMetadata, GetRequest, GetResponses, GetPagination>
    >
  >,
  const PostMetadata extends RuntimeMethodMetadata = Record<never, never>,
  const PostRequest extends RuntimeMethodRequest = Record<never, never>,
  const PostResponses extends EndpointResponsesContract | undefined = undefined,
  const PostReturn extends DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, PostMetadata, PostRequest, PostResponses>>
  > = DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, PostMetadata, PostRequest, PostResponses>>
  >,
  const PutMetadata extends RuntimeMethodMetadata = Record<never, never>,
  const PutRequest extends RuntimeMethodRequest = Record<never, never>,
  const PutResponses extends EndpointResponsesContract | undefined = undefined,
  const PutReturn extends DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, PutMetadata, PutRequest, PutResponses>>
  > = DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, PutMetadata, PutRequest, PutResponses>>
  >,
  const PatchMetadata extends RuntimeMethodMetadata = Record<never, never>,
  const PatchRequest extends RuntimeMethodRequest = Record<never, never>,
  const PatchResponses extends EndpointResponsesContract | undefined = undefined,
  const PatchReturn extends DeepReadonly<
    HandlerReturn<
      ResolvedRuntimeMethodDefinition<Params, PatchMetadata, PatchRequest, PatchResponses>
    >
  > = DeepReadonly<
    HandlerReturn<
      ResolvedRuntimeMethodDefinition<Params, PatchMetadata, PatchRequest, PatchResponses>
    >
  >,
  const DeleteMetadata extends RuntimeMethodMetadata = Record<never, never>,
  const DeleteRequest extends RuntimeMethodRequest = Record<never, never>,
  const DeleteResponses extends EndpointResponsesContract | undefined = undefined,
  const DeleteReturn extends DeepReadonly<
    HandlerReturn<
      ResolvedRuntimeMethodDefinition<Params, DeleteMetadata, DeleteRequest, DeleteResponses>
    >
  > = DeepReadonly<
    HandlerReturn<
      ResolvedRuntimeMethodDefinition<Params, DeleteMetadata, DeleteRequest, DeleteResponses>
    >
  >,
  const Definition extends Record<string, unknown> = Record<never, never>,
>(
  definition: Definition & {
    /** A method group contains handlers only inside method entries. */
    handler?: never
    /** A name identifies one HTTP method, so declare it inside the method entry. */
    name?: never
    request?: {
      params?: Params
      query?: never
      headers?: never
      body?: never
    }
    idempotency?: RouteContractIdempotencyInput
    /** A method group has no root pagination contract. */
    pagination?: never
    /** Responses are per method: declare them inside each method entry. */
    responses?: never
    params?: never
    validate?: never
    response?: never
    get?: InferredRuntimeMethod<
      Params,
      GetMetadata,
      GetRequest,
      GetResponses,
      GetReturn,
      GetPagination
    >
    post?: InferredRuntimeMethod<Params, PostMetadata, PostRequest, PostResponses, PostReturn>
    put?: InferredRuntimeMethod<Params, PutMetadata, PutRequest, PutResponses, PutReturn>
    patch?: InferredRuntimeMethod<Params, PatchMetadata, PatchRequest, PatchResponses, PatchReturn>
    delete?: InferredRuntimeMethod<
      Params,
      DeleteMetadata,
      DeleteRequest,
      DeleteResponses,
      DeleteReturn
    >
    /** Derived from the `get` entry with the body dropped. */
    head?: never
    /** Answered as `204` with an `Allow` header for the declared methods. */
    options?: never
    /** Not routed on this support line. */
    connect?: never
    /** Not routed on this support line. */
    trace?: never
  },
): EndpointRouteMethodsEventHandler<
  Definition & {
    request?: { params?: Params }
    get?: InferredRuntimeMethod<
      Params,
      GetMetadata,
      GetRequest,
      GetResponses,
      GetReturn,
      GetPagination
    >
    post?: InferredRuntimeMethod<Params, PostMetadata, PostRequest, PostResponses, PostReturn>
    put?: InferredRuntimeMethod<Params, PutMetadata, PutRequest, PutResponses, PutReturn>
    patch?: InferredRuntimeMethod<Params, PatchMetadata, PatchRequest, PatchResponses, PatchReturn>
    delete?: InferredRuntimeMethod<
      Params,
      DeleteMetadata,
      DeleteRequest,
      DeleteResponses,
      DeleteReturn
    >
  },
  RouteMethodSuccessBody<Definition>
>
export function defineEndpoint(
  definition: RuntimeMethodsDefinition | RuntimeMethodDefinition,
): unknown {
  if ('handler' in definition && typeof definition.handler === 'function') {
    const contract = toEndpointDefinition(definition)
    const endpoint = createEndpoint(contract)
    return Object.assign(
      defineEndpointHandler(endpoint, (context) =>
        definition.handler(toEndpointRouteEvent(context, contract)),
      ),
      { '~routeDef': definition },
    )
  }

  const methodsDefinition = definition as RuntimeMethodsDefinition
  assertEndpointAuthoringShape(methodsDefinition, 'shared')
  if ('name' in methodsDefinition) {
    throw new TypeError(
      'A method-group endpoint cannot declare a root name. Declare name inside each method entry.',
    )
  }
  const endpoints: Record<string, unknown> = {}
  const handlers: Record<string, (context: EndpointContext<any>) => unknown> = {}
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    const entry = methodsDefinition[method]
    if (!entry) continue
    assertEndpointAuthoringShape(entry, 'method')
    const contract = toEndpointDefinition(entry, definition.request?.params, 'method')
    endpoints[method] = createEndpoint(contract)
    handlers[method] = (context) => entry.handler(toEndpointRouteEvent(context, contract))
  }
  return Object.assign(
    defineEndpointMethodHandlers(defineEndpointMethods(endpoints as never), handlers as never),
    { '~routeDef': definition },
  ) as EndpointRouteMethodsEventHandler<RuntimeMethodsDefinition>
}

function toEndpointRouteEvent<DEFINITION extends EndpointDefinition>(
  context: EndpointContext<DEFINITION>,
  routeDef: DEFINITION,
): EndpointRouteEvent<DEFINITION> {
  return Object.assign(context.event, {
    routeDef,
    validated: {
      params: context.params,
      query: context.query,
      headers: context.headers,
      body: context.body,
    },
    respond: context.respond,
    bodyMediaType: context.bodyMediaType,
    responseMediaType: context.responseMediaType,
  })
}

function createEndpoint(definition: EndpointDefinition): DefinedEndpoint<EndpointDefinition> {
  validateEndpointDefinition(definition)
  const options = routeHandlerRuntimeOptions(definition)
  const { idempotency, ...contract } = definition
  const endpoint = new DefinedEndpoint(contract, options)
  return idempotency
    ? endpoint.idempotency({
        headerName: idempotency.headerName,
        required: idempotency.required,
      })
    : endpoint
}

function routeHandlerRuntimeOptions(definition: EndpointDefinition): EndpointRuntimeOptions {
  return {
    validation: { response: definition.responses !== undefined },
    deferIdempotencyFingerprintValidation: true,
  }
}

function toEndpointDefinition(
  definition: RuntimeMethodDefinition,
  params: ValidatorSchema | undefined = definition.request?.params,
  requestLocation: 'single' | 'method' = 'single',
): EndpointDefinition {
  assertEndpointAuthoringShape(definition, requestLocation)
  const { handler: _handler, request, responses: authoredResponses, ...metadata } = definition
  const query = request?.query
  const responses = normalizeResponses(authoredResponses)
  const contract: EndpointDefinition = {
    ...metadata,
    idempotency: normalizeEndpointIdempotencyMetadata(metadata.idempotency),
    params,
    query,
    headers: request?.headers,
    body: request?.body,
    responses,
  }
  if (metadata.pagination?.kind === 'cursor') {
    const paginated = applyCursorPaginationContract(query, responses, metadata.pagination)
    contract.query = paginated.query
    contract.responses = paginated.responses as EndpointResponsesContract
  }
  return contract
}

function assertEndpointAuthoringShape(
  definition: Record<string, unknown>,
  requestLocation: 'single' | 'shared' | 'method',
): void {
  if (requestLocation === 'shared' && 'responses' in definition) {
    throw new TypeError(
      'A method-group endpoint must declare `responses` inside each method entry.',
    )
  }
  for (const removed of ['params', 'validate', 'response']) {
    if (removed in definition) {
      throw new TypeError(
        `Endpoint contract \`${removed}\` is not supported. Declare request schemas under \`request\` and status responses under \`responses\`.`,
      )
    }
  }
  const request = definition.request
  if (request === undefined) return
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    throw new TypeError('Endpoint contract `request` must be an object.')
  }
  const allowed = new Set(
    requestLocation === 'single'
      ? ['params', 'query', 'headers', 'body']
      : requestLocation === 'shared'
        ? ['params']
        : ['query', 'headers', 'body'],
  )
  const unknown = Object.keys(request).find((key) => !allowed.has(key))
  if (unknown) {
    throw new TypeError(
      `Endpoint contract request field \`${unknown}\` is not supported in this location.`,
    )
  }
}

function normalizeResponses(
  response: ValidatorSchema | EndpointResponsesContract | undefined,
): EndpointResponsesContract | undefined {
  if (!response) return undefined
  return isValidatorSchema(response) ? { 200: response } : response
}

function isValidatorSchema(value: unknown): value is ValidatorSchema {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('~standard' in value || 'parse' in value || 'ast' in value)
  )
}
