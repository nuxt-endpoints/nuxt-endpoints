// Writing the outgoing response: the status and headers a declared contract
// resolves to, and the error shape used for internal faults. This is the half
// of the seam that stays with the contract layer — core validates what comes
// in, but which status and headers go out is decided by the declaration that
// this module owns. See README.md.
import { createError, setHeaders, setResponseStatus } from 'h3'
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
 * platform serializes a thrown error (which changes between h3 majors).
 */
export function createRuntimeError(options: RuntimeHttpErrorOptions): Error {
  return createError(options)
}

export function setRuntimeResponseStatus(
  event: RuntimeEvent,
  status: number,
  statusMessage?: string,
): void {
  if (statusMessage) {
    setResponseStatus(event, status, statusMessage)
    return
  }
  setResponseStatus(event, status)
}

export function setRuntimeResponseHeaders(
  event: RuntimeEvent,
  headers: Record<string, string>,
): void {
  setHeaders(event, headers)
}
