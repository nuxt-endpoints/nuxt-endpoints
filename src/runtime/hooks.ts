// Application-wide extension points, default-exported from
// `server/endpoints/hooks.ts`. The keys mirror the per-endpoint runtime
// options exactly, so moving a hook between the two scopes is a move, not a
// rewrite. This file is server runtime code: it is bundled into Nitro and
// never evaluated during build-time discovery, so it may hold real
// infrastructure references.
import type { EndpointDefinition } from './contract'
import type { EndpointHandlerWrapper } from './interceptor'
import type { EndpointValidationErrorHandler } from './validation-error'

export type EndpointHooks = {
  /**
   * Shapes the response for any request that does not match its contract. An
   * endpoint's own `onValidationError` wins; this runs when that one is absent
   * or declines by returning nothing.
   */
  onValidationError?: EndpointValidationErrorHandler
  /**
   * Wraps handler execution for every endpoint, outside both the endpoint's
   * own wrapper and its idempotency handling.
   */
  wrapHandler?: EndpointHandlerWrapper<EndpointDefinition>
}

export function defineEndpointHooks(hooks: EndpointHooks): EndpointHooks {
  if (typeof hooks !== 'object' || hooks === null) {
    throw new TypeError('defineEndpointHooks() expects an object of hooks.')
  }
  for (const key of ['onValidationError', 'wrapHandler'] as const) {
    const value = hooks[key]
    if (value !== undefined && typeof value !== 'function') {
      throw new TypeError(`defineEndpointHooks(): "${key}" must be a function when provided.`)
    }
  }
  return hooks
}
