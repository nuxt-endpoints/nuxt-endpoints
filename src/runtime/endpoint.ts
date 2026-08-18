import type {
  EndpointContext,
  EndpointDefinition,
  EndpointHandler,
  EndpointIdempotencyMetadata,
  EndpointSuccessBody,
  HasEndpointResponses,
  IsSuccessStatus,
  ResponseContract,
  UnknownIfNever,
} from './contract'
import { idempotencyRuntimeOptionKeys, validateIdempotencyTtl } from './idempotency'
import {
  createRuntimeError,
  defineRuntimeHandler,
  getRuntimeQuery,
  getRuntimeRequestHeaders,
  getRuntimeWebRequest,
  readRuntimeBody,
  setRuntimeResponseHeaders,
  setRuntimeResponseStatus,
} from './h3-adapter'
import type { RuntimeEvent } from './h3-adapter'
import { createIdempotencyInterceptor } from './idempotency-interceptor'
import type { EndpointIdempotencyPolicy } from './idempotency-policy'
import type { IdempotencyRuntimeOptionKey, IdempotencyStorage } from './idempotency'
import { createResponse, isStatusResponse } from './response'
import type { StatusResponse } from './response'
import type {
  EndpointInterceptor,
  EndpointInterceptorNext,
  EndpointRuntimeResponse,
} from './interceptor'
import { parseValidator } from './validator'
import type { ValidationIssue } from './validator'

export type EndpointRuntimeOptions = {
  validation?: {
    response?: boolean
  }
}

type MaybePromise<VALUE> = VALUE | Promise<VALUE>

export type EndpointIdempotencyContext<DEFINITION extends EndpointDefinition> = Omit<
  EndpointContext<DEFINITION>,
  'respond'
>

/**
 * Sentinel authorization value meaning "handled outside `.idempotency()`,
 * typically by server middleware that runs before this handler."
 */
export type IdempotencyAuthorizationDelegation = 'middleware'

export type EndpointIdempotencyOptions<DEFINITION extends EndpointDefinition> = {
  // storage/scope/authorization may instead be supplied by the central policy
  // in server/endpoints/idempotency.ts, so they are optional here; build-time
  // and startup validation enforce that every endpoint ends up with all three.
  storage?: (context: EndpointIdempotencyContext<DEFINITION>) => MaybePromise<IdempotencyStorage>
  scope?: (context: EndpointIdempotencyContext<DEFINITION>) => MaybePromise<string>
  authorization?:
    | IdempotencyAuthorizationDelegation
    | ((context: EndpointIdempotencyContext<DEFINITION>) => MaybePromise<void>)
  fingerprint?: (context: EndpointIdempotencyContext<DEFINITION>) => MaybePromise<unknown>
  headerName?: string
  required?: boolean
  leaseTtlMs?: number
  replayTtlMs?: number
  replayStatuses?: readonly number[]
}

export type EndpointRouteIdentity = {
  method: string
  routeTemplate: string
}

// Re-exported so `src/runtime/index.ts` keeps importing it from here; the
// type now lives in idempotency-interceptor.ts next to the code that builds
// and consumes `IdempotencyProblem` values.
export type { IdempotencyProblem } from './idempotency-interceptor'

// Erased view of `EndpointContext<DEFINITION>` handed to idempotency
// callbacks (storage/scope/authorization/fingerprint). Exported so
// idempotency-interceptor.ts can share it without redefining the shape.
export type RuntimeIdempotencyContext = {
  event: RuntimeEvent
  params: unknown
  query: unknown
  headers: unknown
  body: unknown
}

type RequestValidationProblem = {
  statusCode: 400
  statusMessage: 'Validation Error'
  data: Record<string, readonly RequestValidationIssue[]>
}

type RequestValidationIssue = {
  path?: readonly (string | number)[]
  message: string
  code?: string
}

type ParsedRequestPart =
  | { success: true; value: unknown }
  | { success: false; issues: readonly ValidationIssue[] }

type RequestValidationFailure = { success: false; problem: RequestValidationProblem }

type BuildContextResult<DEFINITION extends EndpointDefinition> =
  | { success: true; context: EndpointContext<DEFINITION> }
  | RequestValidationFailure

export type NormalizedEndpointIdempotencyOptions = {
  storage?: (context: RuntimeIdempotencyContext) => MaybePromise<IdempotencyStorage>
  scope?: (context: RuntimeIdempotencyContext) => MaybePromise<string>
  authorization?:
    | IdempotencyAuthorizationDelegation
    | ((context: RuntimeIdempotencyContext) => MaybePromise<void>)
  fingerprint?: (context: RuntimeIdempotencyContext) => MaybePromise<unknown>
  headerName: string
  required: boolean
  leaseTtlMs?: number
  replayTtlMs?: number
  replayStatuses: readonly number[]
}

/**
 * Records, per `.idempotency()` call, which runtime options the endpoint
 * itself supplied. Nitro startup fills the rest from the central policy (if
 * any) and rejects endpoints that still have gaps afterward.
 */
export type EndpointIdempotencyRuntimeMarker = Record<IdempotencyRuntimeOptionKey, boolean>

// Shared by module.ts (build-time detection) and server-plugin.ts (startup
// validation), which both reject hand-written idempotency metadata that
// bypassed `.idempotency()` and therefore carries no runtime marker.
export function idempotencyMetadataWithoutRuntimeMessage(subject: string): string {
  return `[nuxt-endpoints] Idempotency metadata ${subject} has no matching server runtime policy. Use DefinedEndpoint.idempotency() instead of writing metadata directly.`
}

const defaultIdempotencyHeaderName = 'Idempotency-Key'

type HeaderNameFromOptions<OPTIONS> = OPTIONS extends { headerName: infer NAME extends string }
  ? NAME
  : typeof defaultIdempotencyHeaderName

type RequiredFromOptions<OPTIONS> = OPTIONS extends { required: infer REQUIRED extends boolean }
  ? REQUIRED
  : false

export class DefinedEndpoint<const DEFINITION extends EndpointDefinition> {
  public readonly __idempotency_runtime_marker__: false | EndpointIdempotencyRuntimeMarker

  constructor(
    public readonly definition: DEFINITION,
    private readonly options: EndpointRuntimeOptions = {},
    private readonly idempotencyOptions?: NormalizedEndpointIdempotencyOptions,
    idempotencyRuntimeMarker?: EndpointIdempotencyRuntimeMarker,
  ) {
    this.__idempotency_runtime_marker__ =
      idempotencyOptions !== undefined
        ? (idempotencyRuntimeMarker ?? createIdempotencyRuntimeMarker(() => false))
        : false
  }

  // Two overloads (rather than one generic signature with a default type
  // param) because a default type param on an optional parameter defeats
  // inference from a passed argument in TypeScript's checker: calling
  // `.idempotency({ required: true })` would otherwise resolve OPTIONS to
  // the default instead of the argument.
  idempotency(): DefinedEndpoint<
    DEFINITION & {
      idempotency: EndpointIdempotencyMetadata<typeof defaultIdempotencyHeaderName, false>
    }
  >
  idempotency<const OPTIONS extends EndpointIdempotencyOptions<DEFINITION>>(
    options: OPTIONS,
  ): DefinedEndpoint<
    DEFINITION & {
      idempotency: EndpointIdempotencyMetadata<
        HeaderNameFromOptions<OPTIONS>,
        RequiredFromOptions<OPTIONS>
      >
    }
  >
  idempotency(
    options?: EndpointIdempotencyOptions<DEFINITION>,
  ): DefinedEndpoint<DEFINITION & { idempotency: EndpointIdempotencyMetadata }> {
    const normalized = normalizeIdempotencyOptions(options ?? {})
    const marker = createIdempotencyRuntimeMarker((key) => options?.[key] !== undefined)
    const definition = {
      ...this.definition,
      idempotency: {
        enabled: true as const,
        headerName: normalized.headerName,
        required: normalized.required,
      },
    }

    return new DefinedEndpoint(definition, this.options, normalized, marker)
  }

  handler<const HANDLER extends (context: EndpointContext<DEFINITION>) => unknown>(
    handler: HasEndpointResponses<DEFINITION> extends true ? never : HANDLER,
  ): EndpointEventHandler<DEFINITION, ReturnType<HANDLER>>
  handler<const ACTUAL_RETURN>(
    handler: HasEndpointResponses<DEFINITION> extends true
      ? EndpointHandler<DEFINITION, ACTUAL_RETURN>
      : never,
  ): EndpointEventHandler<DEFINITION, ACTUAL_RETURN>
  handler(
    handler: (context: EndpointContext<DEFINITION>) => unknown,
  ): EndpointEventHandler<DEFINITION, unknown> {
    let routeIdentity: EndpointRouteIdentity | undefined
    let idempotencyPolicy: EndpointIdempotencyPolicy | undefined
    const idempotencyOptions = this.idempotencyOptions

    // `routeIdentity` and `idempotencyPolicy` are injected after `.handler()`
    // returns (via `__set_endpoint_route__`/`__set_idempotency_policy__`), so
    // the interceptor reads them through getters rather than capturing them
    // by value here.
    const interceptor: EndpointInterceptor<DEFINITION> | undefined = idempotencyOptions
      ? createIdempotencyInterceptor<DEFINITION>({
          options: idempotencyOptions,
          getRouteIdentity: () => routeIdentity,
          getPolicy: () => idempotencyPolicy,
        })
      : undefined

    const eventHandler = defineRuntimeHandler(
      async (event: RuntimeEvent): Promise<EndpointHandlerSuccessBody<DEFINITION, unknown>> => {
        const contextResult = await buildContext(
          this.definition,
          event,
          idempotencyOptions?.headerName,
        )
        if (!contextResult.success) {
          return applyRequestValidationProblem(
            event,
            contextResult.problem,
          ) as EndpointHandlerSuccessBody<DEFINITION, unknown>
        }

        const context = contextResult.context
        const execute: EndpointInterceptorNext = () => this.executeHandler(handler, context)
        const response = interceptor
          ? await interceptor({ event, context }, execute)
          : await execute()
        return applyEndpointResponse(event, response) as EndpointHandlerSuccessBody<
          DEFINITION,
          unknown
        >
      },
    )

    return Object.assign(eventHandler, {
      __endpoint_contract__: this,
      __endpoint_handler_return__: undefined,
      __set_endpoint_route__: (identity: EndpointRouteIdentity) => {
        const normalized = normalizeRouteIdentity(identity)
        if (
          routeIdentity &&
          (routeIdentity.method !== normalized.method ||
            routeIdentity.routeTemplate !== normalized.routeTemplate)
        ) {
          throw new Error(
            `An idempotent endpoint handler cannot be attached to multiple route identities (${routeIdentity.method} ${routeIdentity.routeTemplate} and ${normalized.method} ${normalized.routeTemplate}).`,
          )
        }
        routeIdentity = normalized
      },
      __set_idempotency_policy__: (policy: EndpointIdempotencyPolicy | undefined) => {
        idempotencyPolicy = policy
      },
    })
  }

  private async executeHandler(
    handler: (context: EndpointContext<DEFINITION>) => unknown,
    context: EndpointContext<DEFINITION>,
  ): Promise<EndpointRuntimeResponse> {
    const result = await handler(context)

    if (isStatusResponse(result)) {
      await this.validateResponse(result.status, result.body)
      return {
        status: result.status,
        body: result.body,
        headers: result.headers,
        explicitStatus: true,
      }
    }

    await this.validateResponse(200, result)
    return { status: 200, body: result, explicitStatus: false }
  }

  private async validateResponse(status: number, body: unknown) {
    if (!this.options.validation?.response) {
      return
    }

    const contract = getResponseContract(this.definition, status)
    if (!contract) {
      throw createRuntimeError({
        statusCode: 500,
        statusMessage: 'Response Contract Error',
        data: {
          status,
          issues: [{ message: `Response status ${status} is not declared` }],
        },
      })
    }

    const schema = getResponseBodySchema(contract)
    const result = await parseValidator(schema, body)
    if (!result.success) {
      throw createRuntimeError({
        statusCode: 500,
        statusMessage: 'Response Contract Error',
        data: {
          status,
          issues: result.issues,
        },
      })
    }
  }
}

export type EndpointEventHandler<
  DEFINITION extends EndpointDefinition,
  HANDLER_RETURN = unknown,
> = ((event: RuntimeEvent) => Promise<EndpointHandlerSuccessBody<DEFINITION, HANDLER_RETURN>>) & {
  __endpoint_contract__: DefinedEndpoint<DEFINITION>
  __endpoint_handler_return__: HANDLER_RETURN
  __set_endpoint_route__: (identity: EndpointRouteIdentity) => void
  __set_idempotency_policy__: (policy: EndpointIdempotencyPolicy | undefined) => void
}

type EndpointHandlerSuccessBody<DEFINITION extends EndpointDefinition, HANDLER_RETURN> =
  HasEndpointResponses<DEFINITION> extends true
    ? EndpointSuccessBody<DEFINITION>
    : InferredEndpointHandlerSuccessBody<Awaited<HANDLER_RETURN>>

type InferredEndpointHandlerSuccessBody<VALUE> = UnknownIfNever<
  InferredDirectHandlerSuccessBody<VALUE> | InferredStatusHandlerSuccessBody<VALUE>
>

type InferredDirectHandlerSuccessBody<VALUE> = VALUE extends unknown
  ? VALUE extends StatusResponse<number, unknown>
    ? never
    : VALUE
  : never

type InferredStatusHandlerSuccessBody<VALUE> =
  VALUE extends StatusResponse<infer STATUS extends number, infer BODY>
    ? IsSuccessStatus<STATUS> extends true
      ? BODY
      : never
    : never

export function defineEndpoint<const DEFINITION extends EndpointDefinition>(
  definition: DEFINITION &
    ([DEFINITION] extends [{ idempotency: unknown }] ? { idempotency?: never } : unknown),
  options?: EndpointRuntimeOptions,
): DefinedEndpoint<DEFINITION> {
  return new DefinedEndpoint(definition, options)
}

export function defineEndpointHandler<
  const DEFINITION extends EndpointDefinition,
  const HANDLER extends (context: EndpointContext<DEFINITION>) => unknown,
>(
  endpoint: DefinedEndpoint<DEFINITION>,
  handler: HasEndpointResponses<DEFINITION> extends true ? never : HANDLER,
): EndpointEventHandler<DEFINITION, ReturnType<HANDLER>>
export function defineEndpointHandler<
  const DEFINITION extends EndpointDefinition,
  const ACTUAL_RETURN,
>(
  endpoint: DefinedEndpoint<DEFINITION>,
  handler: HasEndpointResponses<DEFINITION> extends true
    ? EndpointHandler<DEFINITION, ACTUAL_RETURN>
    : never,
): EndpointEventHandler<DEFINITION, ACTUAL_RETURN>
export function defineEndpointHandler<const DEFINITION extends EndpointDefinition>(
  endpoint: DefinedEndpoint<DEFINITION>,
  handler: (context: EndpointContext<DEFINITION>) => unknown,
): EndpointEventHandler<DEFINITION, unknown> {
  return endpoint.handler(handler as never)
}

async function buildContext<DEFINITION extends EndpointDefinition>(
  definition: DEFINITION,
  event: RuntimeEvent,
  excludedHeaderName?: string,
): Promise<BuildContextResult<DEFINITION>> {
  const params = await parsePart(definition.params, event.context.params || {})
  if (!params.success) return validationFailure('params', params.issues)

  const query = await parsePart(definition.query, getRuntimeQuery(event))
  if (!query.success) return validationFailure('query', query.issues)

  const headers = await parsePart(
    definition.headers,
    omitRequestHeader(getRuntimeRequestHeaders(event), excludedHeaderName),
  )
  if (!headers.success) return validationFailure('headers', headers.issues)

  const body = definition.body
    ? await parsePart(definition.body, await readRuntimeBody(event))
    : ({ success: true, value: undefined } as const)
  if (!body.success) return validationFailure('body', body.issues)

  return {
    success: true,
    context: {
      event,
      request: getRuntimeWebRequest(event),
      params: params.value,
      query: query.value,
      headers: headers.value,
      body: body.value,
      respond: createResponse,
    } as EndpointContext<DEFINITION>,
  }
}

function validationFailure(
  part: string,
  issues: readonly ValidationIssue[],
): RequestValidationFailure {
  return {
    success: false,
    problem: {
      statusCode: 400,
      statusMessage: 'Validation Error',
      data: { [part]: issues.map(toRequestValidationIssue) },
    },
  }
}

function toRequestValidationIssue(issue: ValidationIssue): RequestValidationIssue {
  const runtimeIssue = issue as ValidationIssue & { type?: unknown }
  const path = issue.path
    ?.map((segment) => {
      if (typeof segment === 'string' || typeof segment === 'number') return segment
      if (typeof segment === 'object' && segment !== null && 'key' in segment) {
        return typeof segment.key === 'string' || typeof segment.key === 'number'
          ? segment.key
          : undefined
      }
      return undefined
    })
    .filter((segment): segment is string | number => segment !== undefined)
  const code = issue.code ?? (typeof runtimeIssue.type === 'string' ? runtimeIssue.type : undefined)

  return {
    ...(path?.length ? { path } : {}),
    message: issue.message,
    ...(code ? { code } : {}),
  }
}

function createIdempotencyRuntimeMarker(
  predicate: (key: IdempotencyRuntimeOptionKey) => boolean,
): EndpointIdempotencyRuntimeMarker {
  return Object.fromEntries(
    idempotencyRuntimeOptionKeys.map((key) => [key, predicate(key)]),
  ) as EndpointIdempotencyRuntimeMarker
}

function normalizeIdempotencyOptions<DEFINITION extends EndpointDefinition>(
  options: EndpointIdempotencyOptions<DEFINITION>,
): NormalizedEndpointIdempotencyOptions {
  const headerName = options.headerName ?? defaultIdempotencyHeaderName
  if (!isValidHttpHeaderName(headerName)) {
    throw new TypeError('Idempotency headerName must be a valid HTTP header field name')
  }

  const replayStatuses = options.replayStatuses ?? []
  for (const status of replayStatuses) {
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new TypeError('Idempotency replayStatuses must contain HTTP status integers')
    }
  }

  // The endpoint-validated context types (`EndpointIdempotencyContext<DEFINITION>`)
  // are erased to the runtime's untyped context at this boundary; the actual
  // object handed to these callbacks at request time is identical either way.
  const runtimeCallbacks = options as unknown as Pick<
    NormalizedEndpointIdempotencyOptions,
    'storage' | 'scope' | 'authorization' | 'fingerprint'
  >

  return {
    storage: runtimeCallbacks.storage,
    scope: runtimeCallbacks.scope,
    authorization: runtimeCallbacks.authorization,
    fingerprint: runtimeCallbacks.fingerprint,
    headerName,
    required: options.required ?? false,
    leaseTtlMs:
      options.leaseTtlMs !== undefined
        ? validateIdempotencyTtl(options.leaseTtlMs, 'leaseTtlMs')
        : undefined,
    replayTtlMs:
      options.replayTtlMs !== undefined
        ? validateIdempotencyTtl(options.replayTtlMs, 'replayTtlMs')
        : undefined,
    replayStatuses: [...replayStatuses],
  }
}

function isValidHttpHeaderName(value: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)
}

function omitRequestHeader(
  headers: Readonly<Record<string, unknown>>,
  excludedHeaderName?: string,
): Record<string, unknown> {
  if (!excludedHeaderName) {
    return { ...headers }
  }
  const lowerName = excludedHeaderName.toLowerCase()
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== lowerName),
  )
}

function normalizeRouteIdentity(identity: EndpointRouteIdentity): EndpointRouteIdentity {
  if (!identity.method || !identity.routeTemplate) {
    throw new TypeError('Endpoint route identity requires a method and routeTemplate')
  }
  return { method: identity.method.toLowerCase(), routeTemplate: identity.routeTemplate }
}

function applyEndpointResponse(event: RuntimeEvent, response: EndpointRuntimeResponse): unknown {
  if (response.explicitStatus) {
    setRuntimeResponseStatus(event, response.status)
  }
  if (response.headers) {
    setRuntimeResponseHeaders(event, { ...response.headers })
  }
  return response.body
}

function getResponseContract(
  definition: EndpointDefinition,
  status: number,
): ResponseContract | undefined {
  if (definition.responses) {
    return definition.responses[status] || definition.responses[String(status)]
  }
  if (status === 200) {
    return definition.response
  }
  return undefined
}

function getResponseBodySchema(contract: ResponseContract) {
  if (typeof contract === 'object' && contract !== null && 'body' in contract) {
    return contract.body
  }
  return contract
}

async function parsePart(
  schema: EndpointDefinition[keyof Pick<
    EndpointDefinition,
    'params' | 'query' | 'headers' | 'body'
  >],
  input: unknown,
): Promise<ParsedRequestPart> {
  if (!schema) {
    return { success: true, value: undefined }
  }

  const result = await parseValidator(schema, input)
  if (result.success) {
    return { success: true, value: result.value }
  }

  return { success: false, issues: result.issues }
}

function applyRequestValidationProblem(
  event: RuntimeEvent,
  problem: RequestValidationProblem,
): RequestValidationProblem {
  setRuntimeResponseStatus(event, problem.statusCode, problem.statusMessage)
  setRuntimeResponseHeaders(event, { 'content-type': 'application/json' })
  return problem
}
