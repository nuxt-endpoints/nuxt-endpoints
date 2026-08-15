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
import {
  createIdempotencyFingerprint,
  createIdempotencyStorageKey,
  hasHttpControlCharacter,
  validateIdempotencyTtl,
} from './idempotency'
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
import type { EndpointIdempotencyPolicy } from './idempotency-policy'
import type {
  IdempotencyReleaseInput,
  IdempotencyStorage,
  IdempotencyStoredResponse,
} from './idempotency'
import { createResponse, isStatusResponse } from './response'
import type { StatusResponse } from './response'
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

export type IdempotencyProblem = {
  type: 'about:blank'
  title: string
  status: 400 | 409 | 422
  detail: string
  code:
    | 'IDEMPOTENCY_KEY_REQUIRED'
    | 'IDEMPOTENCY_KEY_INVALID'
    | 'IDEMPOTENCY_REQUEST_IN_FLIGHT'
    | 'IDEMPOTENCY_KEY_REUSED'
    | 'IDEMPOTENCY_LEASE_LOST'
}

type RuntimeIdempotencyContext = {
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

type NormalizedEndpointIdempotencyOptions = {
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

// Single source of truth for which runtime options an endpoint can either
// supply itself (in `.idempotency()`) or delegate to the central policy.
export const idempotencyRuntimeOptionKeys = ['storage', 'scope', 'authorization'] as const
export type IdempotencyRuntimeOptionKey = (typeof idempotencyRuntimeOptionKeys)[number]

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
    const eventHandler = defineRuntimeHandler(
      async (event: RuntimeEvent): Promise<EndpointHandlerSuccessBody<DEFINITION, unknown>> => {
        const contextResult = await buildContext(
          this.definition,
          event,
          this.idempotencyOptions?.headerName,
        )
        if (!contextResult.success) {
          return applyRequestValidationProblem(
            event,
            contextResult.problem,
          ) as EndpointHandlerSuccessBody<DEFINITION, unknown>
        }

        const context = contextResult.context
        const execute = async () => this.executeHandler(handler, context)
        const idempotency = this.idempotencyOptions

        if (!idempotency) {
          return applyEndpointResponse(event, await execute()) as EndpointHandlerSuccessBody<
            DEFINITION,
            unknown
          >
        }

        const key = readIdempotencyKey(event, idempotency.headerName)
        if (key.outcome === 'invalid') {
          return applyIdempotencyProblem(
            event,
            createIdempotencyProblem(
              400,
              'Bad Request',
              `The ${idempotency.headerName} header must contain one value between 1 and 255 characters without control characters or commas.`,
              'IDEMPOTENCY_KEY_INVALID',
            ),
          ) as EndpointHandlerSuccessBody<DEFINITION, unknown>
        }
        if (key.outcome === 'missing' && idempotency.required) {
          return applyIdempotencyProblem(
            event,
            createIdempotencyProblem(
              400,
              'Bad Request',
              `The ${idempotency.headerName} header is required for this endpoint.`,
              'IDEMPOTENCY_KEY_REQUIRED',
            ),
          ) as EndpointHandlerSuccessBody<DEFINITION, unknown>
        }

        const runtime = resolveIdempotencyRuntimeOptions(idempotency, idempotencyPolicy)
        const runtimeContext = context as unknown as RuntimeIdempotencyContext
        if (runtime.authorization !== 'middleware') {
          await runtime.authorization(runtimeContext)
        }

        if (key.outcome === 'missing') {
          return applyEndpointResponse(event, await execute()) as EndpointHandlerSuccessBody<
            DEFINITION,
            unknown
          >
        }

        if (!routeIdentity) {
          throw createRuntimeError({
            statusCode: 500,
            statusMessage: 'Idempotency Route Metadata Error',
            data: { message: 'The endpoint route identity was not injected at Nitro startup.' },
          })
        }

        const storage = await runtime.storage(runtimeContext)
        assertIdempotencyStorage(storage)
        const scope = await runtime.scope(runtimeContext)
        if (typeof scope !== 'string' || scope.length === 0) {
          throw createRuntimeError({
            statusCode: 500,
            statusMessage: 'Idempotency Scope Error',
            data: { message: 'The idempotency scope resolver must return a non-empty string.' },
          })
        }

        const projection = idempotency.fingerprint
          ? await idempotency.fingerprint(runtimeContext)
          : { params: context.params, query: context.query, body: context.body }
        const fingerprint = await createIdempotencyFingerprint(projection)
        const storageKey = await createIdempotencyStorageKey({
          method: routeIdentity.method,
          routeTemplate: routeIdentity.routeTemplate,
          scope,
          key: key.value,
        })
        const lease = globalThis.crypto.randomUUID()
        const claim = await storage.claim({
          storageKey,
          fingerprint,
          lease,
          leaseTtlMs: runtime.leaseTtlMs,
        })

        if (claim.outcome === 'completed') {
          return replayStoredResponse(event, claim.response) as EndpointHandlerSuccessBody<
            DEFINITION,
            unknown
          >
        }
        if (claim.outcome === 'conflict') {
          return applyIdempotencyProblem(
            event,
            createIdempotencyProblem(
              422,
              'Unprocessable Content',
              'This idempotency key was already used with a different request.',
              'IDEMPOTENCY_KEY_REUSED',
            ),
          ) as EndpointHandlerSuccessBody<DEFINITION, unknown>
        }
        if (claim.outcome === 'in-flight') {
          return applyIdempotencyProblem(
            event,
            createIdempotencyProblem(
              409,
              'Conflict',
              'A request with this idempotency key is still being processed.',
              'IDEMPOTENCY_REQUEST_IN_FLIGHT',
            ),
          ) as EndpointHandlerSuccessBody<DEFINITION, unknown>
        }
        if (claim.outcome !== 'acquired') {
          throw createRuntimeError({
            statusCode: 500,
            statusMessage: 'Idempotency Storage Error',
            data: { message: 'The storage adapter returned an unknown claim outcome.' },
          })
        }

        const leaseInput = { storageKey, fingerprint, lease }
        let response: EndpointRuntimeResponse
        try {
          response = await execute()
        } catch (error) {
          await releaseLeaseAfterFailure(storage, leaseInput)
          throw error
        }

        if (!isReplayableStatus(response.status, idempotency.replayStatuses)) {
          await storage.release(leaseInput)
          return applyEndpointResponse(event, response) as EndpointHandlerSuccessBody<
            DEFINITION,
            unknown
          >
        }

        let snapshot: IdempotencyBodySnapshot
        try {
          snapshot = createIdempotencyBodySnapshot(response.body)
        } catch (error) {
          await releaseLeaseAfterFailure(storage, leaseInput)
          throw error
        }

        let completion
        try {
          completion = await storage.complete({
            ...leaseInput,
            response: {
              status: response.status,
              hasBody: snapshot.hasBody,
              serializedBody: snapshot.serializedBody,
              headers: filterReplaySafeHeaders(response.headers),
            },
            replayTtlMs: runtime.replayTtlMs,
          })
        } catch (error) {
          await releaseLeaseAfterFailure(storage, leaseInput)
          throw error
        }

        if (completion.outcome === 'lease-lost') {
          return applyIdempotencyProblem(
            event,
            createIdempotencyProblem(
              409,
              'Conflict',
              'The request exceeded its idempotency lease and its response was not recorded.',
              'IDEMPOTENCY_LEASE_LOST',
            ),
          ) as EndpointHandlerSuccessBody<DEFINITION, unknown>
        }
        if (completion.outcome !== 'applied') {
          await releaseLeaseAfterFailure(storage, leaseInput)
          throw createRuntimeError({
            statusCode: 500,
            statusMessage: 'Idempotency Storage Error',
            data: { message: 'The storage adapter returned an unknown completion outcome.' },
          })
        }

        return applyEndpointResponse(event, {
          ...response,
          body: snapshot.body,
        }) as EndpointHandlerSuccessBody<DEFINITION, unknown>
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

type EndpointRuntimeResponse = {
  status: number
  body: unknown
  headers?: Readonly<Record<string, string>>
  explicitStatus: boolean
}

type IdempotencyKeyResult =
  | { outcome: 'missing' }
  | { outcome: 'invalid' }
  | { outcome: 'value'; value: string }

const replaySafeResponseHeaders = new Set([
  'cache-control',
  'content-language',
  'content-type',
  'etag',
  'last-modified',
  'location',
  'retry-after',
])

function createIdempotencyRuntimeMarker(
  predicate: (key: IdempotencyRuntimeOptionKey) => boolean,
): EndpointIdempotencyRuntimeMarker {
  return Object.fromEntries(
    idempotencyRuntimeOptionKeys.map((key) => [key, predicate(key)]),
  ) as EndpointIdempotencyRuntimeMarker
}

// A type predicate (rather than a plain boolean check) so the key-array-driven
// gap check also narrows each field to non-nullable for the caller, the way
// `!storage || !scope || !authorization` used to narrow them individually.
function hasAllIdempotencyRuntimeOptions<T extends Record<IdempotencyRuntimeOptionKey, unknown>>(
  value: T,
): value is { [KEY in keyof T]: NonNullable<T[KEY]> } {
  return idempotencyRuntimeOptionKeys.every((key) => value[key] !== undefined)
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

type ResolvedIdempotencyRuntimeOptions = {
  storage: (context: RuntimeIdempotencyContext) => MaybePromise<IdempotencyStorage>
  scope: (context: RuntimeIdempotencyContext) => MaybePromise<string>
  authorization:
    | IdempotencyAuthorizationDelegation
    | ((context: RuntimeIdempotencyContext) => MaybePromise<void>)
  leaseTtlMs: number
  replayTtlMs: number
}

const defaultIdempotencyLeaseTtlMs = 60_000
const defaultIdempotencyReplayTtlMs = 86_400_000

// Startup validation (server-plugin.ts) guarantees every idempotent endpoint
// resolves storage/scope/authorization from itself or the central policy, so
// this is a defensive fallback rather than a path exercised in practice.
function resolveIdempotencyRuntimeOptions(
  endpointOptions: NormalizedEndpointIdempotencyOptions,
  policy: EndpointIdempotencyPolicy | undefined,
): ResolvedIdempotencyRuntimeOptions {
  // The policy's context type (`EndpointIdempotencyContext<EndpointDefinition>`)
  // is erased the same way as in `normalizeIdempotencyOptions`.
  const runtimePolicy = policy as unknown as Partial<ResolvedIdempotencyRuntimeOptions> | undefined
  const resolved = {
    storage: endpointOptions.storage ?? runtimePolicy?.storage,
    scope: endpointOptions.scope ?? runtimePolicy?.scope,
    authorization: endpointOptions.authorization ?? runtimePolicy?.authorization,
  }

  if (!hasAllIdempotencyRuntimeOptions(resolved)) {
    throw createRuntimeError({
      statusCode: 500,
      statusMessage: 'Idempotency Runtime Options Error',
      data: {
        message:
          'The endpoint and its central policy together did not provide storage, scope, and authorization.',
      },
    })
  }

  return {
    storage: resolved.storage,
    scope: resolved.scope,
    authorization: resolved.authorization,
    leaseTtlMs:
      endpointOptions.leaseTtlMs ?? runtimePolicy?.leaseTtlMs ?? defaultIdempotencyLeaseTtlMs,
    replayTtlMs:
      endpointOptions.replayTtlMs ?? runtimePolicy?.replayTtlMs ?? defaultIdempotencyReplayTtlMs,
  }
}

function isValidHttpHeaderName(value: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)
}

function readIdempotencyKey(event: RuntimeEvent, headerName: string): IdempotencyKeyResult {
  const lowerName = headerName.toLowerCase()
  const values: string[] = []

  for (const [name, value] of Object.entries(getRuntimeRequestHeaders(event))) {
    if (name.toLowerCase() !== lowerName || value === undefined) {
      continue
    }
    values.push(value)
  }

  if (values.length === 0) {
    return { outcome: 'missing' }
  }
  if (values.length !== 1) {
    return { outcome: 'invalid' }
  }

  const value = values[0]!
  if (
    value.length === 0 ||
    value.length > 255 ||
    value.includes(',') ||
    hasHttpControlCharacter(value)
  ) {
    return { outcome: 'invalid' }
  }
  return { outcome: 'value', value }
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

function assertIdempotencyStorage(value: unknown): asserts value is IdempotencyStorage {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('claim' in value) ||
    typeof value.claim !== 'function' ||
    !('complete' in value) ||
    typeof value.complete !== 'function' ||
    !('release' in value) ||
    typeof value.release !== 'function'
  ) {
    throw createRuntimeError({
      statusCode: 500,
      statusMessage: 'Idempotency Storage Error',
      data: { message: 'The idempotency storage resolver returned an invalid adapter.' },
    })
  }
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

function replayStoredResponse(event: RuntimeEvent, response: IdempotencyStoredResponse): unknown {
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
    throw createRuntimeError({
      statusCode: 500,
      statusMessage: 'Idempotency Storage Error',
      data: { message: 'The stored response has an invalid HTTP status.' },
    })
  }

  if (typeof response.hasBody !== 'boolean') {
    throw createRuntimeError({
      statusCode: 500,
      statusMessage: 'Idempotency Storage Error',
      data: { message: 'The stored response must declare whether it has a body.' },
    })
  }
  if (typeof response.serializedBody !== 'string') {
    throw createRuntimeError({
      statusCode: 500,
      statusMessage: 'Idempotency Storage Error',
      data: { message: 'The stored response body must be JSON text.' },
    })
  }
  if (!response.hasBody) {
    if (response.serializedBody !== '') {
      throw createRuntimeError({
        statusCode: 500,
        statusMessage: 'Idempotency Storage Error',
        data: { message: 'A stored empty response must have an empty serialized body.' },
      })
    }
    setRuntimeResponseStatus(event, response.status)
    const headers = filterReplaySafeHeaders(response.headers)
    if (headers && Object.keys(headers).length > 0) {
      setRuntimeResponseHeaders(event, headers)
    }
    return undefined
  }

  let body: unknown
  try {
    body = JSON.parse(response.serializedBody)
  } catch (error) {
    throw createRuntimeError({
      statusCode: 500,
      statusMessage: 'Idempotency Storage Error',
      data: { message: 'The stored response body is not valid JSON.', cause: error },
    })
  }

  setRuntimeResponseStatus(event, response.status)
  const headers = filterReplaySafeHeaders(response.headers)
  if (headers && Object.keys(headers).length > 0) {
    setRuntimeResponseHeaders(event, headers)
  }
  return body
}

function filterReplaySafeHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined
  }
  const safeHeaders: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase()
    if (replaySafeResponseHeaders.has(normalizedName)) {
      safeHeaders[normalizedName] = value
    }
  }
  return Object.keys(safeHeaders).length > 0 ? safeHeaders : undefined
}

function isReplayableStatus(status: number, additionalStatuses: readonly number[]): boolean {
  return (status >= 200 && status < 300) || additionalStatuses.includes(status)
}

type IdempotencyBodySnapshot =
  | { hasBody: false; serializedBody: ''; body: undefined }
  | { hasBody: true; serializedBody: string; body: unknown }

function createIdempotencyBodySnapshot(body: unknown): IdempotencyBodySnapshot {
  try {
    if (body === undefined) {
      return { hasBody: false, serializedBody: '', body: undefined }
    }
    if (typeof Response !== 'undefined' && body instanceof Response) {
      throw new TypeError('Native Response values are not supported by idempotency replay')
    }
    const serialized = JSON.stringify(body)
    if (serialized === undefined) {
      throw new TypeError('The response body is not JSON serializable')
    }
    return { hasBody: true, serializedBody: serialized, body: JSON.parse(serialized) }
  } catch (error) {
    throw createRuntimeError({
      statusCode: 500,
      statusMessage: 'Idempotency Response Serialization Error',
      data: { message: 'The endpoint response body is not JSON serializable.', cause: error },
    })
  }
}

async function releaseLeaseAfterFailure(
  storage: IdempotencyStorage,
  input: IdempotencyReleaseInput,
): Promise<void> {
  try {
    await storage.release(input)
  } catch {
    // Preserve the original handler/storage error. The lease TTL is the final
    // recovery boundary when best-effort release cannot reach the adapter.
  }
}

function createIdempotencyProblem(
  status: IdempotencyProblem['status'],
  title: string,
  detail: string,
  code: IdempotencyProblem['code'],
): IdempotencyProblem {
  return { type: 'about:blank', title, status, detail, code }
}

function applyIdempotencyProblem(
  event: RuntimeEvent,
  problem: IdempotencyProblem,
): IdempotencyProblem {
  setRuntimeResponseStatus(event, problem.status)
  setRuntimeResponseHeaders(event, { 'content-type': 'application/problem+json' })
  return problem
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
