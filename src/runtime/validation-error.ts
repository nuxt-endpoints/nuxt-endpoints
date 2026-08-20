// The extension point for shaping the responses this module produces when a
// request does not match its contract. It sits at the validation boundary,
// before the interception seam in interceptor.ts: an interceptor only ever
// sees a request that already validated, so it cannot describe these failures.
import type { RuntimeEvent } from './h3-adapter'
import type { ValidationIssue } from './validator'

/** Which part of the request failed to match the contract. */
export type EndpointValidationSource = 'params' | 'query' | 'headers' | 'body'

export type EndpointValidationFailure =
  | {
      kind: 'schema'
      source: EndpointValidationSource
      issues: readonly ValidationIssue[]
      event: RuntimeEvent
    }
  | {
      kind: 'media-type'
      source: 'body'
      /** The request's normalized Content-Type, or `null` when it sent none. */
      received: string | null
      supportedMediaTypes: readonly string[]
      event: RuntimeEvent
    }
  | {
      /**
       * The response-side counterpart of `media-type`: the endpoint can only
       * produce media types the request refused. It carries the same two field
       * names so one handler can shape both, but they mean mirrored things -
       * `supportedMediaTypes` is what this endpoint can *produce* rather than
       * consume, and `received` is the raw `Accept` header (a weighted list,
       * not a single type, so there is nothing to normalize it to).
       */
      kind: 'accept'
      source: 'headers'
      /** The request's raw Accept header, or `null` when it sent none. */
      received: string | null
      supportedMediaTypes: readonly string[]
      event: RuntimeEvent
    }

export type EndpointValidationErrorResponse = {
  status: number
  /** HTTP reason phrase. Defaults are kept for the built-in shapes. */
  statusText?: string
  body: unknown
  headers?: Record<string, string>
}

/**
 * Returns the response to send for a failure, or nothing to fall through: an
 * endpoint-level handler falls back to the application-level one, and that
 * falls back to this module's default shape.
 */
export type EndpointValidationErrorHandler = (
  failure: EndpointValidationFailure,
) => EndpointValidationErrorResponse | undefined | void

/**
 * Declares the application-wide validation-error handler, default-exported
 * from `server/endpoints/validation.ts`. It is server runtime code, so it is
 * bundled into Nitro and never evaluated during build-time discovery.
 */
export function defineValidationErrorHandler(
  handler: EndpointValidationErrorHandler,
): EndpointValidationErrorHandler {
  if (typeof handler !== 'function') {
    throw new TypeError(
      'defineValidationErrorHandler() expects a function receiving the validation failure.',
    )
  }
  return handler
}

export function isValidationErrorResponse(
  value: unknown,
): value is EndpointValidationErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    typeof (value as { status: unknown }).status === 'number'
  )
}
