// The h3 event and handler surface: how a contract-bearing handler is
// registered with the platform, and how the platform's event reaches the rest
// of the runtime. Everything else in this package sees `RuntimeEvent`, never
// `H3Event` — that one alias is what keeps the h3 major version a detail of
// this directory. See README.md for where each call goes on h3 v2.
import { defineEventHandler, toWebRequest } from 'h3'
import type { H3Event } from 'h3'

export type RuntimeEvent = H3Event

export function defineRuntimeHandler<RESPONSE>(
  handler: (event: RuntimeEvent) => RESPONSE,
): (event: RuntimeEvent) => RESPONSE {
  return defineEventHandler(handler as never) as unknown as (event: RuntimeEvent) => RESPONSE
}

/**
 * Normalizes the platform event into a Web `Request` for the handler context.
 * The one call in this directory with no h3 v2 equivalent — `event.req` is
 * already a `Request` there, so this becomes a property read.
 */
export function getRuntimeWebRequest(event: RuntimeEvent): Request {
  return toWebRequest(event)
}

/**
 * Reads the incoming request's HTTP method (e.g. `'GET'`). Used by the
 * method-dispatch runtime (endpoint-methods.ts) to pick which declared
 * method's sub-handler runs.
 */
export function getRuntimeMethod(event: RuntimeEvent): string {
  return event.method
}
