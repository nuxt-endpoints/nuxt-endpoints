// Application-wide endpoint settings, default-exported from
// `server/endpoints/runtime.ts`. This is the half of endpoint configuration
// that `nuxt.config.ts` cannot hold: module options reach the server through
// JSON serialization and so cannot carry functions, or the connections they
// close over. The hook keys mirror the per-endpoint runtime options exactly,
// so moving one between scopes is a move rather than a rewrite.
import type { EndpointDefinition } from './contract'
import type { EndpointIdempotencyPolicy } from './idempotency-policy'
import type { OpenApiDocument, OpenApiDocumentPatch } from './openapi'
import type { EndpointHandlerWrapper } from './interceptor'
import type { EndpointValidationErrorHandler } from './validation-error'

export type EndpointRuntime = {
  /**
   * Shapes the response for any request that does not match its contract. An
   * endpoint's own `onValidationError` wins; this runs when that one is absent
   * or declines by returning nothing.
   */
  onValidationError?: EndpointValidationErrorHandler
  /**
   * Wraps handler execution for every endpoint, outside both an endpoint's own
   * wrapper and its idempotency handling.
   */
  wrapHandler?: EndpointHandlerWrapper<EndpointDefinition>
  /**
   * Shared wiring for endpoints that opted into `Idempotency-Key` replay
   * protection with `.idempotency()`. Any endpoint may override each part.
   */
  idempotency?: EndpointIdempotencyPolicy
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
  if (typeof runtime !== 'object' || runtime === null) {
    throw new TypeError('defineEndpointRuntime() expects an object.')
  }
  for (const key of ['onValidationError', 'wrapHandler'] as const) {
    const value = runtime[key]
    if (value !== undefined && typeof value !== 'function') {
      throw new TypeError(`defineEndpointRuntime(): "${key}" must be a function when provided.`)
    }
  }
  if (runtime.idempotency !== undefined && typeof runtime.idempotency !== 'object') {
    throw new TypeError('defineEndpointRuntime(): "idempotency" must be a policy object.')
  }
  if (runtime.openApi !== undefined) {
    if (typeof runtime.openApi !== 'object' || runtime.openApi === null) {
      throw new TypeError('defineEndpointRuntime(): "openApi" must be an object.')
    }
    if (runtime.openApi.document !== undefined && typeof runtime.openApi.document !== 'object') {
      throw new TypeError('defineEndpointRuntime(): "openApi.document" must be an object.')
    }
    if (runtime.openApi.extend !== undefined && typeof runtime.openApi.extend !== 'function') {
      throw new TypeError('defineEndpointRuntime(): "openApi.extend" must be a function.')
    }
  }
  return runtime
}
