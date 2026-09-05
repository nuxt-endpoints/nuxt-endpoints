import type {
  DeepReadonly,
  EndpointBodyMediaTypeMap,
  EndpointContext,
  EndpointDefinition,
  EndpointIdempotencyMetadata,
  EndpointResponsesContract,
  HandlerReturn,
  HasEndpointResponses,
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
  type EndpointRouteIdentity,
  type EndpointRuntimeOptions,
  validateEndpointDefinition,
} from './endpoint'
import { defineEndpointMethodHandlers, defineEndpointMethods } from './endpoint-methods'
import type { EndpointRuntime } from './endpoint-runtime'
import type { RuntimeContractEvent, RuntimeEvent } from './platform'
import type { InferInput, ValidatorSchema } from './validator'

type RouteValidation<QUERY, HEADERS, BODY, RESPONSES> = {
  query?: QUERY
  headers?: HEADERS
  body?: BODY
  response?: RESPONSES
}

// The contract carries only portable metadata. Request-time settings have no
// public per-endpoint transport yet: callbacks cannot enter build evaluation,
// and accepting the serializable settings here would silently discard them.
// The shared key union also drives JavaScript definition-time validation.
type RouteContractIdempotency = {
  [KEY in IdempotencyRouteContractForbiddenOptionKey]?: never
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
  params?: PARAMS
  validate?: RouteValidation<QUERY, HEADERS, BODY, RESPONSES>
  summary?: SUMMARY
  description?: DESCRIPTION
  tags?: TAGS
  idempotency?: IDEMPOTENCY & RouteContractIdempotency
  /**
   * Projects this endpoint into a native `<form>` on a page. The constraint
   * refuses a contract a browser could not produce a request for - see
   * form-projection.ts.
   */
  form?: FORM & NativeFormProjectionConstraint<FORM, QUERY, HEADERS, BODY, IDEMPOTENCY>
  pagination?: PAGINATION & PaginationContractConstraint<PAGINATION, QUERY, RESPONSES>
  handler: CapturedRouteHandler<NoInfer<DEFINITION>, ACTUAL_RETURN>
}

type RuntimeMethodMetadata = {
  summary?: string
  description?: string
  tags?: string[]
  idempotency?: EndpointIdempotencyMetadata & RouteContractIdempotency
}

type RuntimeMethodValidation = RouteValidation<
  ValidatorSchema,
  ValidatorSchema,
  ValidatorSchema | EndpointBodyMediaTypeMap,
  EndpointResponsesContract
>

type RuntimeMethodDefinition = RuntimeMethodMetadata & {
  pagination?: EndpointPaginationContract
  validate?: RuntimeMethodValidation
  handler: (event: EndpointRouteEvent<any>) => unknown
}

type RuntimeMethodsDefinition = {
  params?: ValidatorSchema
  validate?: never
  get?: RuntimeMethodDefinition
  post?: RuntimeMethodDefinition
  put?: RuntimeMethodDefinition
  patch?: RuntimeMethodDefinition
  delete?: RuntimeMethodDefinition
  head?: RuntimeMethodDefinition
  options?: RuntimeMethodDefinition
  connect?: RuntimeMethodDefinition
  trace?: RuntimeMethodDefinition
}

type RouteMethodKey =
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete'
  | 'head'
  | 'options'
  | 'connect'
  | 'trace'

type PropertyOf<Value, Key extends PropertyKey> = Value extends unknown
  ? Key extends keyof Value
    ? Exclude<Value[Key], undefined> extends infer Property
      ? [Property] extends [never]
        ? undefined
        : Property
      : never
    : undefined
  : never

type ValidationPropertyOf<Value, Key extends PropertyKey> = PropertyOf<
  PropertyOf<Value, 'validate'>,
  Key
>

type PaginationOf<Value> = Value extends {
  pagination: infer PAGINATION extends EndpointPaginationContract
}
  ? PAGINATION
  : undefined

type EndpointDefinitionOf<Method, Params> = {
  params: Params
  query: ApplyPaginationQuery<ValidationPropertyOf<Method, 'query'>, PaginationOf<Method>>
  headers: ValidationPropertyOf<Method, 'headers'>
  body: ValidationPropertyOf<Method, 'body'>
  responses: ApplyPaginationResponses<
    ValidationPropertyOf<Method, 'response'>,
    PaginationOf<Method>
  >
  summary: PropertyOf<Method, 'summary'>
  description: PropertyOf<Method, 'description'>
  tags: PropertyOf<Method, 'tags'>
  idempotency: PropertyOf<Method, 'idempotency'>
  pagination: PaginationOf<Method>
}

type RouteMethodKeys<Definition> = Extract<keyof Definition, RouteMethodKey>

type ResolvedEndpointDefinition<Definition, Method extends RouteMethodKeys<Definition>> =
  EndpointDefinitionOf<
    Definition[Method],
    PropertyOf<Definition, 'params'>
  > extends infer MethodDefinition extends EndpointDefinition
    ? MethodDefinition
    : never

type ResolvedRuntimeMethodDefinition<
  Params extends ValidatorSchema | undefined,
  Metadata extends RuntimeMethodMetadata,
  Validation extends RuntimeMethodValidation,
  Pagination extends EndpointPaginationContract | undefined = undefined,
> = {
  params: Params
  query: ApplyPaginationQuery<PropertyOf<Validation, 'query'>, Pagination>
  headers: PropertyOf<Validation, 'headers'>
  body: PropertyOf<Validation, 'body'>
  responses: ApplyPaginationResponses<PropertyOf<Validation, 'response'>, Pagination>
  summary: PropertyOf<Metadata, 'summary'>
  description: PropertyOf<Metadata, 'description'>
  tags: PropertyOf<Metadata, 'tags'>
  idempotency: PropertyOf<Metadata, 'idempotency'>
  pagination: Pagination
}

type InferredRuntimeMethod<
  Params extends ValidatorSchema | undefined,
  Metadata extends RuntimeMethodMetadata,
  Validation extends RuntimeMethodValidation,
  ActualReturn,
  Pagination extends EndpointPaginationContract | undefined = undefined,
> = Metadata & {
  validate?: Validation
  pagination?: Pagination &
    PaginationContractConstraint<
      Pagination,
      PropertyOf<Validation, 'query'>,
      PropertyOf<Validation, 'response'>
    >
  handler: CapturedRouteHandler<
    ResolvedRuntimeMethodDefinition<Params, Metadata, Validation, Pagination>,
    ActualReturn
  >
}

type RouteMethodContracts<Definition> = {
  [Method in RouteMethodKeys<Definition>]: DefinedEndpoint<
    ResolvedEndpointDefinition<Definition, Method>
  >
}

type RouteMethodHandlerReturns<Definition> = {
  -readonly [Method in RouteMethodKeys<Definition>]-?: Definition[Method] extends {
    handler: (...args: never[]) => infer Return
  }
    ? Awaited<Return>
    : never
}

type RouteMethodSuccessBody<Definition> = {
  [Method in RouteMethodKeys<Definition>]: EndpointHandlerSuccessBody<
    ResolvedEndpointDefinition<Definition, Method>,
    RouteMethodHandlerReturns<Definition>[Method]
  >
}[RouteMethodKeys<Definition>]

type EndpointRouteRequest<Definition extends EndpointDefinition> = {
  body: RouteBodyInput<Definition['body']>
  query: RouteSchemaInput<Definition['query']>
  headers: RouteSchemaInput<Definition['headers']>
}

type RouteMethodRequest<Definition> = {
  [Method in RouteMethodKeys<Definition>]: EndpointRouteRequest<
    ResolvedEndpointDefinition<Definition, Method>
  >
}[RouteMethodKeys<Definition>]

type RouteSchemaInput<Schema> = Schema extends ValidatorSchema ? InferInput<Schema> : never

type RouteBodyInput<Body> = Body extends ValidatorSchema
  ? InferInput<Body>
  : Body extends Record<string, infer Member>
    ? Member extends ValidatorSchema
      ? InferInput<Member>
      : Member extends true
        ? ReadableStream<Uint8Array> | null
        : never
    : never

export type EndpointRouteMethodsEventHandler<Definition> = ((
  event: RuntimeContractEvent<RouteMethodRequest<Definition>>,
) => Promise<RouteMethodSuccessBody<Definition>>) & {
  readonly '~routeDef': Definition
  __endpoint_contracts__: RouteMethodContracts<Definition>
  __endpoint_method_handler_returns__: RouteMethodHandlerReturns<Definition>
  __set_endpoint_route__: (identity: EndpointRouteIdentity) => void
  __set_endpoint_runtime__: (runtime: EndpointRuntime | undefined) => void
}

export type EndpointDefinitionFromRoute<Definition, Method extends string | undefined = undefined> =
  Method extends RouteMethodKeys<Definition>
    ? ResolvedEndpointDefinition<Definition, Method>
    : EndpointDefinitionOf<Definition, PropertyOf<Definition, 'params'>>

/**
 * H3 deliberately carries unknown metadata without interpreting it. Cursor
 * pagination is an NE contract constructor, so this overlays only the fields
 * it generates onto H3/Nitro's otherwise authoritative normalized contract.
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

type EndpointRouteEventHandler<
  Definition,
  Return,
  ResolvedDefinition extends EndpointDefinition =
    EndpointDefinitionFromRoute<Definition> extends infer Resolved extends EndpointDefinition
      ? Resolved
      : EndpointDefinition,
> = ((event: RuntimeContractEvent<EndpointRouteRequest<ResolvedDefinition>>) => Promise<Return>) & {
  readonly '~routeDef': Definition
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
> & { idempotency: IDEMPOTENCY; form: FORM; pagination: PAGINATION }

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
  params?: PARAMS
  validate?: RouteValidation<QUERY, HEADERS, BODY, RESPONSES>
  summary?: SUMMARY
  description?: DESCRIPTION
  tags?: TAGS
  idempotency?: IDEMPOTENCY & RouteContractIdempotency
  form?: FORM & NativeFormProjectionConstraint<FORM, QUERY, HEADERS, BODY, IDEMPOTENCY>
  pagination: EndpointCursorPaginationContract<ITEM> &
    PaginationContractConstraint<EndpointCursorPaginationContract<ITEM>, QUERY, RESPONSES>
  handler: CapturedRouteHandler<NoInfer<DEFINITION>, ACTUAL_RETURN>
}

/**
 * Nuxt Endpoints adapter for H3's unified route-handler authoring shape.
 * Nitro treats the direct call as a compiler macro; at runtime this adapter
 * keeps only NE's application-level context, idempotency, and response policy.
 */
export function defineRouteHandler<
  const PARAMS extends ValidatorSchema | undefined = undefined,
  const QUERY extends ValidatorSchema | undefined = undefined,
  const HEADERS extends ValidatorSchema | undefined = undefined,
  const BODY extends ValidatorSchema | EndpointBodyMediaTypeMap | undefined = undefined,
  const RESPONSES extends EndpointResponsesContract | undefined = undefined,
  const SUMMARY extends string | undefined = undefined,
  const DESCRIPTION extends string | undefined = undefined,
  TAGS extends string[] | undefined = undefined,
  const IDEMPOTENCY extends (EndpointIdempotencyMetadata & RouteContractIdempotency) | undefined =
    undefined,
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
export function defineRouteHandler<
  const PARAMS extends ValidatorSchema | undefined = undefined,
  const QUERY extends ValidatorSchema | undefined = undefined,
  const HEADERS extends ValidatorSchema | undefined = undefined,
  const BODY extends ValidatorSchema | EndpointBodyMediaTypeMap | undefined = undefined,
  const RESPONSES extends EndpointResponsesContract | undefined = undefined,
  const SUMMARY extends string | undefined = undefined,
  const DESCRIPTION extends string | undefined = undefined,
  TAGS extends string[] | undefined = undefined,
  const IDEMPOTENCY extends (EndpointIdempotencyMetadata & RouteContractIdempotency) | undefined =
    undefined,
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
>(
  definition: RouteHandlerInput<
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
  > & { idempotency: IDEMPOTENCY; form: FORM; pagination: PAGINATION },
  EndpointHandlerSuccessBody<
    DEFINITION,
    HasEndpointResponses<DEFINITION> extends true
      ? ACTUAL_RETURN
      : WidenCapturedReturn<ACTUAL_RETURN>
  >
>
export function defineRouteHandler<
  const Params extends ValidatorSchema | undefined = undefined,
  const GetMetadata extends RuntimeMethodMetadata = Record<never, never>,
  const GetValidation extends RuntimeMethodValidation = Record<never, never>,
  const GetPagination extends EndpointPaginationContract | undefined = undefined,
  const GetReturn extends DeepReadonly<
    HandlerReturn<
      ResolvedRuntimeMethodDefinition<Params, GetMetadata, GetValidation, GetPagination>
    >
  > = DeepReadonly<
    HandlerReturn<
      ResolvedRuntimeMethodDefinition<Params, GetMetadata, GetValidation, GetPagination>
    >
  >,
  const PostMetadata extends RuntimeMethodMetadata = Record<never, never>,
  const PostValidation extends RuntimeMethodValidation = Record<never, never>,
  const PostReturn extends DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, PostMetadata, PostValidation>>
  > = DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, PostMetadata, PostValidation>>
  >,
  const PutMetadata extends RuntimeMethodMetadata = Record<never, never>,
  const PutValidation extends RuntimeMethodValidation = Record<never, never>,
  const PutReturn extends DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, PutMetadata, PutValidation>>
  > = DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, PutMetadata, PutValidation>>
  >,
  const PatchMetadata extends RuntimeMethodMetadata = Record<never, never>,
  const PatchValidation extends RuntimeMethodValidation = Record<never, never>,
  const PatchReturn extends DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, PatchMetadata, PatchValidation>>
  > = DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, PatchMetadata, PatchValidation>>
  >,
  const DeleteMetadata extends RuntimeMethodMetadata = Record<never, never>,
  const DeleteValidation extends RuntimeMethodValidation = Record<never, never>,
  const DeleteReturn extends DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, DeleteMetadata, DeleteValidation>>
  > = DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, DeleteMetadata, DeleteValidation>>
  >,
  const HeadMetadata extends RuntimeMethodMetadata = Record<never, never>,
  const HeadValidation extends RuntimeMethodValidation = Record<never, never>,
  const HeadReturn extends DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, HeadMetadata, HeadValidation>>
  > = DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, HeadMetadata, HeadValidation>>
  >,
  const OptionsMetadata extends RuntimeMethodMetadata = Record<never, never>,
  const OptionsValidation extends RuntimeMethodValidation = Record<never, never>,
  const OptionsReturn extends DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, OptionsMetadata, OptionsValidation>>
  > = DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, OptionsMetadata, OptionsValidation>>
  >,
  const ConnectMetadata extends RuntimeMethodMetadata = Record<never, never>,
  const ConnectValidation extends RuntimeMethodValidation = Record<never, never>,
  const ConnectReturn extends DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, ConnectMetadata, ConnectValidation>>
  > = DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, ConnectMetadata, ConnectValidation>>
  >,
  const TraceMetadata extends RuntimeMethodMetadata = Record<never, never>,
  const TraceValidation extends RuntimeMethodValidation = Record<never, never>,
  const TraceReturn extends DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, TraceMetadata, TraceValidation>>
  > = DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, TraceMetadata, TraceValidation>>
  >,
  const Definition extends Record<string, unknown> = Record<never, never>,
>(
  definition: Definition & {
    params?: Params
    idempotency?: EndpointIdempotencyMetadata & RouteContractIdempotency
    /** A method group has no root pagination contract. */
    pagination?: never
    /** Request validation is per method: declare it inside each method entry. */
    validate?: never
    get?: InferredRuntimeMethod<Params, GetMetadata, GetValidation, GetReturn, GetPagination>
    post?: InferredRuntimeMethod<Params, PostMetadata, PostValidation, PostReturn>
    put?: InferredRuntimeMethod<Params, PutMetadata, PutValidation, PutReturn>
    patch?: InferredRuntimeMethod<Params, PatchMetadata, PatchValidation, PatchReturn>
    delete?: InferredRuntimeMethod<Params, DeleteMetadata, DeleteValidation, DeleteReturn>
    head?: InferredRuntimeMethod<Params, HeadMetadata, HeadValidation, HeadReturn>
    options?: InferredRuntimeMethod<Params, OptionsMetadata, OptionsValidation, OptionsReturn>
    connect?: InferredRuntimeMethod<Params, ConnectMetadata, ConnectValidation, ConnectReturn>
    trace?: InferredRuntimeMethod<Params, TraceMetadata, TraceValidation, TraceReturn>
  },
): EndpointRouteMethodsEventHandler<
  Definition & {
    params?: Params
    get?: InferredRuntimeMethod<Params, GetMetadata, GetValidation, GetReturn, GetPagination>
    post?: InferredRuntimeMethod<Params, PostMetadata, PostValidation, PostReturn>
    put?: InferredRuntimeMethod<Params, PutMetadata, PutValidation, PutReturn>
    patch?: InferredRuntimeMethod<Params, PatchMetadata, PatchValidation, PatchReturn>
    delete?: InferredRuntimeMethod<Params, DeleteMetadata, DeleteValidation, DeleteReturn>
    head?: InferredRuntimeMethod<Params, HeadMetadata, HeadValidation, HeadReturn>
    options?: InferredRuntimeMethod<Params, OptionsMetadata, OptionsValidation, OptionsReturn>
    connect?: InferredRuntimeMethod<Params, ConnectMetadata, ConnectValidation, ConnectReturn>
    trace?: InferredRuntimeMethod<Params, TraceMetadata, TraceValidation, TraceReturn>
  }
>
export function defineRouteHandler(
  definition: RuntimeMethodsDefinition | (RuntimeMethodDefinition & { params?: ValidatorSchema }),
): unknown {
  if ('handler' in definition && typeof definition.handler === 'function') {
    const contract = toEndpointDefinition(definition)
    validateEndpointDefinition(contract)
    const options = routeHandlerRuntimeOptions(contract)
    const endpoint = createRouteEndpoint(contract, options)
    return Object.assign(
      defineEndpointHandler(endpoint, (context) =>
        definition.handler(toEndpointRouteEvent(context, contract)),
      ),
      { '~routeDef': definition },
    )
  }

  const methodsDefinition = definition as RuntimeMethodsDefinition
  const endpoints: Record<string, unknown> = {}
  const handlers: Record<string, (context: EndpointContext<any>) => unknown> = {}
  for (const method of [
    'get',
    'post',
    'put',
    'patch',
    'delete',
    'head',
    'options',
    'connect',
    'trace',
  ] as const) {
    const entry = methodsDefinition[method]
    if (!entry) continue
    const contract = toEndpointDefinition(entry, definition.params)
    validateEndpointDefinition(contract)
    const options = routeHandlerRuntimeOptions(contract)
    endpoints[method] = createRouteEndpoint(contract, options)
    handlers[method] = (context) => entry.handler(toEndpointRouteEvent(context, contract))
  }
  return Object.assign(
    defineEndpointMethodHandlers(defineEndpointMethods(endpoints as never), handlers as never),
    { '~routeDef': definition },
  ) as EndpointRouteMethodsEventHandler<RuntimeMethodsDefinition>
}

function createRouteEndpoint(
  definition: EndpointDefinition,
  options: EndpointRuntimeOptions,
): DefinedEndpoint<EndpointDefinition> {
  const endpoint = new DefinedEndpoint(definition, options)
  return definition.idempotency
    ? (
        endpoint as DefinedEndpoint<
          EndpointDefinition & { idempotency: EndpointIdempotencyMetadata }
        >
      ).idempotencyRuntime()
    : endpoint
}

function routeHandlerRuntimeOptions(definition: EndpointDefinition): EndpointRuntimeOptions {
  return {
    validation: { response: definition.responses !== undefined },
    deferIdempotencyFingerprintValidation: true,
  }
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

function toEndpointDefinition(
  definition: RuntimeMethodDefinition,
  params: ValidatorSchema | undefined = (
    definition as RuntimeMethodDefinition & { params?: ValidatorSchema }
  ).params,
): EndpointDefinition {
  const { handler: _handler, validate, ...metadata } = definition
  const query = validate?.query
  const responses = normalizeResponses(validate?.response)
  const contract: EndpointDefinition = {
    ...metadata,
    params,
    query,
    headers: validate?.headers,
    body: validate?.body,
    responses,
  }
  if (metadata.pagination?.kind === 'cursor') {
    const paginated = applyCursorPaginationContract(query, responses, metadata.pagination)
    contract.query = paginated.query
    contract.responses = paginated.responses as EndpointResponsesContract
  }
  return contract
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
