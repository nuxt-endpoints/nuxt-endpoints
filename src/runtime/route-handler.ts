import type {
  CapturedEndpointHandler,
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
import {
  defineEndpoint,
  defineEndpointHandler,
  type AssembledEndpointContract,
  type DefinedEndpoint,
  type EndpointHandlerSuccessBody,
  type EndpointRouteIdentity,
  type EndpointRuntimeOptions,
  validateEndpointDefinition,
} from './endpoint'
import { defineEndpointMethodHandlers, defineEndpointMethods } from './endpoint-methods'
import type { EndpointRuntime } from './endpoint-runtime'
import type { RuntimeEvent } from './platform'
import type { ValidatorSchema } from './validator'

type RouteValidation<QUERY, HEADERS, BODY, RESPONSES> = {
  query?: QUERY
  headers?: HEADERS
  body?: BODY
  response?: RESPONSES
}

type RouteHandlerInput<
  OPERATION,
  PARAMS,
  QUERY,
  HEADERS,
  BODY,
  RESPONSES,
  SUMMARY,
  DESCRIPTION,
  TAGS,
  IDEMPOTENCY,
  DEFINITION extends EndpointDefinition,
  ACTUAL_RETURN,
> = {
  operation?: OPERATION
  params?: PARAMS
  validate?: RouteValidation<QUERY, HEADERS, BODY, RESPONSES>
  summary?: SUMMARY
  description?: DESCRIPTION
  tags?: TAGS
  idempotency?: IDEMPOTENCY
  handler: CapturedEndpointHandler<DEFINITION, ACTUAL_RETURN>
}

type RuntimeMethodMetadata = {
  operation?: string
  summary?: string
  description?: string
  tags?: string[]
  idempotency?: EndpointIdempotencyMetadata
}

type RuntimeMethodValidation = RouteValidation<
  ValidatorSchema,
  ValidatorSchema,
  ValidatorSchema | EndpointBodyMediaTypeMap,
  EndpointResponsesContract
>

type RuntimeMethodDefinition = RuntimeMethodMetadata & {
  validate?: RuntimeMethodValidation
  handler: (context: RuntimeMethodContext) => unknown
}

type RuntimeMethodContext = EndpointContext<any> & {
  params: any
  query: any
  headers: any
  body: any
}

type RuntimeMethodsDefinition = {
  params?: ValidatorSchema
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

type EndpointDefinitionOf<Method, Params> = {
  operation: PropertyOf<Method, 'operation'>
  params: Params
  query: ValidationPropertyOf<Method, 'query'>
  headers: ValidationPropertyOf<Method, 'headers'>
  body: ValidationPropertyOf<Method, 'body'>
  responses: ValidationPropertyOf<Method, 'response'>
  summary: PropertyOf<Method, 'summary'>
  description: PropertyOf<Method, 'description'>
  tags: PropertyOf<Method, 'tags'>
  idempotency: PropertyOf<Method, 'idempotency'>
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
> = {
  operation: PropertyOf<Metadata, 'operation'>
  params: Params
  query: PropertyOf<Validation, 'query'>
  headers: PropertyOf<Validation, 'headers'>
  body: PropertyOf<Validation, 'body'>
  responses: PropertyOf<Validation, 'response'>
  summary: PropertyOf<Metadata, 'summary'>
  description: PropertyOf<Metadata, 'description'>
  tags: PropertyOf<Metadata, 'tags'>
  idempotency: PropertyOf<Metadata, 'idempotency'>
}

type InferredRuntimeMethod<
  Params extends ValidatorSchema | undefined,
  Metadata extends RuntimeMethodMetadata,
  Validation extends RuntimeMethodValidation,
  ActualReturn,
> = Metadata & {
  validate?: Validation
  handler: CapturedEndpointHandler<
    ResolvedRuntimeMethodDefinition<Params, Metadata, Validation>,
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

export type EndpointRouteMethodsEventHandler<Definition> = ((
  event: RuntimeEvent,
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
  readonly '~routeDef': Definition
}

/**
 * Nuxt Endpoints adapter for H3's unified route-handler authoring shape.
 * Nitro treats the direct call as a compiler macro; at runtime this adapter
 * keeps only NE's application-level context, idempotency, and response policy.
 */
export function defineRouteHandler<
  const OPERATION extends string | undefined = undefined,
  const PARAMS extends ValidatorSchema | undefined = undefined,
  const QUERY extends ValidatorSchema | undefined = undefined,
  const HEADERS extends ValidatorSchema | undefined = undefined,
  const BODY extends ValidatorSchema | EndpointBodyMediaTypeMap | undefined = undefined,
  const RESPONSES extends EndpointResponsesContract | undefined = undefined,
  const SUMMARY extends string | undefined = undefined,
  const DESCRIPTION extends string | undefined = undefined,
  TAGS extends string[] | undefined = undefined,
  const IDEMPOTENCY extends EndpointIdempotencyMetadata | undefined = undefined,
  DEFINITION extends EndpointDefinition = AssembledEndpointContract<
    OPERATION,
    PARAMS,
    QUERY,
    HEADERS,
    BODY,
    RESPONSES,
    SUMMARY,
    DESCRIPTION,
    TAGS
  > & { idempotency: IDEMPOTENCY },
  const ACTUAL_RETURN extends DeepReadonly<HandlerReturn<DEFINITION>> = DeepReadonly<
    HandlerReturn<DEFINITION>
  >,
>(
  definition: RouteHandlerInput<
    OPERATION,
    PARAMS,
    QUERY,
    HEADERS,
    BODY,
    RESPONSES,
    SUMMARY,
    DESCRIPTION,
    TAGS,
    IDEMPOTENCY,
    DEFINITION,
    ACTUAL_RETURN
  >,
  options?: EndpointRuntimeOptions<DEFINITION>,
): EndpointRouteEventHandler<
  RouteHandlerInput<
    OPERATION,
    PARAMS,
    QUERY,
    HEADERS,
    BODY,
    RESPONSES,
    SUMMARY,
    DESCRIPTION,
    TAGS,
    IDEMPOTENCY,
    DEFINITION,
    ACTUAL_RETURN
  >,
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
  const GetReturn extends DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, GetMetadata, GetValidation>>
  > = DeepReadonly<
    HandlerReturn<ResolvedRuntimeMethodDefinition<Params, GetMetadata, GetValidation>>
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
    get?: InferredRuntimeMethod<Params, GetMetadata, GetValidation, GetReturn>
    post?: InferredRuntimeMethod<Params, PostMetadata, PostValidation, PostReturn>
    put?: InferredRuntimeMethod<Params, PutMetadata, PutValidation, PutReturn>
    patch?: InferredRuntimeMethod<Params, PatchMetadata, PatchValidation, PatchReturn>
    delete?: InferredRuntimeMethod<Params, DeleteMetadata, DeleteValidation, DeleteReturn>
    head?: InferredRuntimeMethod<Params, HeadMetadata, HeadValidation, HeadReturn>
    options?: InferredRuntimeMethod<Params, OptionsMetadata, OptionsValidation, OptionsReturn>
    connect?: InferredRuntimeMethod<Params, ConnectMetadata, ConnectValidation, ConnectReturn>
    trace?: InferredRuntimeMethod<Params, TraceMetadata, TraceValidation, TraceReturn>
  },
  options?: EndpointRuntimeOptions,
): EndpointRouteMethodsEventHandler<
  Definition & {
    params?: Params
    get?: InferredRuntimeMethod<Params, GetMetadata, GetValidation, GetReturn>
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
  options?: EndpointRuntimeOptions,
): unknown {
  if ('handler' in definition && typeof definition.handler === 'function') {
    const contract = toEndpointDefinition(definition)
    validateEndpointDefinition(contract)
    return Object.assign(defineEndpointHandler(contract, definition.handler, options), {
      '~routeDef': definition,
    })
  }

  const methodsDefinition = definition as RuntimeMethodsDefinition
  const endpoints: Record<string, unknown> = {}
  const handlers: Record<string, (context: RuntimeMethodContext) => unknown> = {}
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
    endpoints[method] = defineEndpoint(toEndpointDefinition(entry, definition.params), options)
    handlers[method] = entry.handler
  }
  return Object.assign(
    defineEndpointMethodHandlers(defineEndpointMethods(endpoints as never), handlers as never),
    { '~routeDef': definition },
  ) as EndpointRouteMethodsEventHandler<RuntimeMethodsDefinition>
}

function toEndpointDefinition(
  definition: RuntimeMethodDefinition,
  params: ValidatorSchema | undefined = (
    definition as RuntimeMethodDefinition & { params?: ValidatorSchema }
  ).params,
): EndpointDefinition {
  const { handler: _handler, validate, ...metadata } = definition
  return {
    ...metadata,
    params,
    query: validate?.query,
    headers: validate?.headers,
    body: validate?.body,
    responses: normalizeResponses(validate?.response),
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
