// Writing the outgoing response: the status and headers a declared contract
// resolves to, and the error shape used for internal faults. This is the half
// of the seam that stays with the contract layer — core validates what comes
// in, but which status and headers go out is decided by the declaration that
// this module owns. See README.md.
import { HTTPError } from 'h3'
import type { RuntimeEvent } from './handler'

export type RuntimeHttpErrorOptions = {
  statusCode: number
  statusMessage: string
  data?: unknown
}

/**
 * Internal 500-class faults only. Documented client-facing failures —
 * validation and every idempotency problem — never throw; they return a value
 * and set the status explicitly, so their bodies do not depend on how the
 * platform serializes a thrown error.
 *
 * That isolation is what makes the h3 v2 wire-shape change safe to adopt here:
 * a thrown error now serializes as `{ message, status, statusText, data }`
 * rather than v1's `{ message, statusCode, statusMessage, data }`, and only
 * this module's own 500s travel that path.
 */
export function createRuntimeError(options: RuntimeHttpErrorOptions): Error {
  return new HTTPError({
    status: options.statusCode,
    statusText: options.statusMessage,
    message: options.statusMessage,
    data: options.data,
  })
}

export function setRuntimeResponseStatus(
  event: RuntimeEvent,
  status: number,
  statusMessage?: string,
): void {
  event.res.status = status
  if (statusMessage) {
    event.res.statusText = statusMessage
  }
}

/**
 * h3 v2 has no wholesale record assignment for response headers — `event.res.headers`
 * is a Web `Headers`, so each name is set individually.
 */
export function setRuntimeResponseHeaders(
  event: RuntimeEvent,
  headers: Record<string, string>,
): void {
  for (const [name, value] of Object.entries(headers)) {
    event.res.headers.set(name, value)
  }
}
