// Application-wide endpoint settings, default-exported from
// `server/endpoints/runtime.ts`. This is the half of endpoint configuration
// that `nuxt.config.ts` cannot hold: module options reach the server through
// JSON serialization and so cannot carry functions, or the connections they
// close over. The hook keys mirror the per-endpoint runtime options exactly,
// so moving one between scopes is a move rather than a rewrite.
import type { EndpointDefinition } from './contract'
import type { EndpointIdempotencyContext } from './endpoint'
import { validateIdempotencyTtl } from './idempotency'
import type { EndpointIdempotencyPolicy } from './idempotency-policy'
import type { OpenApiDocument, OpenApiDocumentPatch } from './openapi'
import type { EndpointHandlerWrapper } from './interceptor'
import type { EndpointValidationErrorHandler } from './validation-error'

type MaybePromise<VALUE> = VALUE | Promise<VALUE>

export const endpointRuntimeRouteMethods = [
  'get',
  'head',
  'post',
  'put',
  'delete',
  'connect',
  'options',
  'trace',
  'patch',
] as const
export type EndpointRuntimeRouteMethod = (typeof endpointRuntimeRouteMethods)[number]

type RouteIdempotencyContext = EndpointIdempotencyContext<EndpointDefinition>

export type EndpointRouteIdempotencyRuntime = {
  fingerprint?: (context: RouteIdempotencyContext) => MaybePromise<unknown>
  replayStatuses?: readonly number[]
  leaseTtlMs?: number
  replayTtlMs?: number
}

export type EndpointRouteRuntime = {
  onValidationError?: EndpointValidationErrorHandler
  idempotency?: EndpointRouteIdempotencyRuntime
}

export type EndpointRouteRuntimeMap = Record<
  string,
  Partial<Record<EndpointRuntimeRouteMethod, EndpointRouteRuntime>>
>

export type EndpointResponseValidationMode = 'always' | 'development' | 'never'

/** Internal startup decision attached to every discovered endpoint handler. */
export type EndpointRuntimeAttachmentOptions = {
  responseValidation: boolean
}

export type EndpointRuntime = {
  /**
   * Runtime checks for values produced by the server. Request validation is
   * always enabled and is not controlled here.
   */
  validation?: {
    /** Defaults to `development`; use `always` for untyped output boundaries. */
    response?: EndpointResponseValidationMode
  }
  /**
   * Shapes the response for any request that does not match its contract. An
   * A route override wins; this runs when that override is absent or declines
   * by returning nothing.
   */
  onValidationError?: EndpointValidationErrorHandler
  /**
   * Wraps handler execution for every endpoint, outside idempotency handling.
   */
  wrapHandler?: EndpointHandlerWrapper<EndpointDefinition>
  /**
   * Shared wiring for contracts that opted into `Idempotency-Key` replay
   * protection. A runtime route entry may override each part.
   */
  idempotency?: EndpointIdempotencyPolicy
  /** Runtime-only overrides keyed by generated route template and HTTP method. */
  routes?: EndpointRouteRuntimeMap
  /**
   * Everything the generated OpenAPI document needs that no endpoint contract
   * can supply: servers, security schemes, tags, and any last-mile edit.
   */
  openApi?: EndpointOpenApiRuntime
}

/**
 * The document-level half of OpenAPI generation. Endpoint contracts describe
 * operations; nothing about an endpoint says where the API is deployed or how
 * it is authenticated, so those belong to the application and live here.
 */
export type EndpointOpenApiRuntime = {
  /**
   * Deep-merged into the generated document before it is served. Use it for
   * declarative additions: `servers`, `components.securitySchemes`, `tags`.
   */
  document?: OpenApiDocumentPatch
  /**
   * Runs last, on the merged document, for anything a patch cannot express -
   * reading generated operation ids, or attaching `security` to specific
   * paths. Mutate the document in place.
   */
  extend?: (document: OpenApiDocument) => void
}

export function defineEndpointRuntime(runtime: EndpointRuntime): EndpointRuntime {
  validateEndpointRuntime(runtime)
  return runtime
}

export function validateEndpointRuntime(runtime: unknown): asserts runtime is EndpointRuntime {
  if (typeof runtime !== 'object' || runtime === null) {
    throw new TypeError('defineEndpointRuntime() expects an object.')
  }
  const candidate = runtime as EndpointRuntime
  if (candidate.validation !== undefined) {
    if (
      typeof candidate.validation !== 'object' ||
      candidate.validation === null ||
      Array.isArray(candidate.validation)
    ) {
      throw new TypeError('defineEndpointRuntime(): "validation" must be an object.')
    }
    assertOnlyRuntimeKeys(candidate.validation, ['response'], 'validation')
    const mode = candidate.validation.response
    if (mode !== undefined && !['always', 'development', 'never'].includes(mode)) {
      throw new TypeError(
        'defineEndpointRuntime(): "validation.response" must be "always", "development", or "never".',
      )
    }
  }
  for (const key of ['onValidationError', 'wrapHandler'] as const) {
    const value = candidate[key]
    if (value !== undefined && typeof value !== 'function') {
      throw new TypeError(`defineEndpointRuntime(): "${key}" must be a function when provided.`)
    }
  }
  if (candidate.idempotency !== undefined && typeof candidate.idempotency !== 'object') {
    throw new TypeError('defineEndpointRuntime(): "idempotency" must be a policy object.')
  }
  if (candidate.routes !== undefined) {
    validateEndpointRouteRuntimeMap(candidate.routes)
  }
  if (candidate.openApi !== undefined) {
    if (typeof candidate.openApi !== 'object' || candidate.openApi === null) {
      throw new TypeError('defineEndpointRuntime(): "openApi" must be an object.')
    }
    if (
      candidate.openApi.document !== undefined &&
      typeof candidate.openApi.document !== 'object'
    ) {
      throw new TypeError('defineEndpointRuntime(): "openApi.document" must be an object.')
    }
    if (candidate.openApi.extend !== undefined && typeof candidate.openApi.extend !== 'function') {
      throw new TypeError('defineEndpointRuntime(): "openApi.extend" must be a function.')
    }
  }
}

export function resolveEndpointResponseValidation(
  runtime: EndpointRuntime | undefined,
  isDevelopment: boolean,
): boolean {
  const mode = runtime?.validation?.response ?? 'development'
  return mode === 'always' || (mode === 'development' && isDevelopment)
}

export function resolveEndpointRouteRuntime(
  runtime: EndpointRuntime | undefined,
  routeTemplate: string,
  method: string,
): EndpointRouteRuntime | undefined {
  return runtime?.routes?.[routeTemplate]?.[method.toLowerCase() as EndpointRuntimeRouteMethod]
}

function validateEndpointRouteRuntimeMap(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('defineEndpointRuntime(): "routes" must be an object.')
  }
  for (const [path, methods] of Object.entries(value)) {
    if (!path.startsWith('/')) {
      throw new TypeError(`defineEndpointRuntime(): routes path "${path}" must start with "/".`)
    }
    if (typeof methods !== 'object' || methods === null || Array.isArray(methods)) {
      throw new TypeError(`defineEndpointRuntime(): routes["${path}"] must be a method map.`)
    }
    for (const [method, routeRuntime] of Object.entries(methods)) {
      if (!(endpointRuntimeRouteMethods as readonly string[]).includes(method)) {
        throw new TypeError(
          `defineEndpointRuntime(): routes["${path}"].${method} is not a supported HTTP method. Use lowercase method names.`,
        )
      }
      validateEndpointRouteRuntime(path, method, routeRuntime)
    }
  }
}

function validateEndpointRouteRuntime(path: string, method: string, value: unknown): void {
  const location = `routes["${path}"].${method}`
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`defineEndpointRuntime(): ${location} must be an object.`)
  }
  const runtime = value as EndpointRouteRuntime
  assertOnlyRuntimeKeys(runtime, ['onValidationError', 'idempotency'], location)
  if (runtime.onValidationError !== undefined && typeof runtime.onValidationError !== 'function') {
    throw new TypeError(
      `defineEndpointRuntime(): ${location}.onValidationError must be a function.`,
    )
  }
  if (runtime.idempotency !== undefined) {
    validateEndpointRouteIdempotencyRuntime(location, runtime.idempotency)
  }
}

function validateEndpointRouteIdempotencyRuntime(location: string, value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`defineEndpointRuntime(): ${location}.idempotency must be an object.`)
  }
  const options = value as EndpointRouteIdempotencyRuntime
  assertOnlyRuntimeKeys(
    options,
    ['fingerprint', 'replayStatuses', 'leaseTtlMs', 'replayTtlMs'],
    `${location}.idempotency`,
  )
  if (options.fingerprint !== undefined && typeof options.fingerprint !== 'function') {
    throw new TypeError(
      `defineEndpointRuntime(): ${location}.idempotency.fingerprint must be a function.`,
    )
  }
  if (options.replayStatuses !== undefined) {
    if (
      !Array.isArray(options.replayStatuses) ||
      options.replayStatuses.some(
        (status) => !Number.isInteger(status) || status < 100 || status > 599,
      )
    ) {
      throw new TypeError(
        `defineEndpointRuntime(): ${location}.idempotency.replayStatuses must contain HTTP status integers.`,
      )
    }
  }
  if (options.leaseTtlMs !== undefined) {
    validateIdempotencyTtl(options.leaseTtlMs, `${location}.idempotency.leaseTtlMs`)
  }
  if (options.replayTtlMs !== undefined) {
    validateIdempotencyTtl(options.replayTtlMs, `${location}.idempotency.replayTtlMs`)
  }
}

function assertOnlyRuntimeKeys(value: object, allowed: readonly string[], location: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key))
  if (unknown) {
    throw new TypeError(`defineEndpointRuntime(): ${location}.${unknown} is not supported.`)
  }
}
