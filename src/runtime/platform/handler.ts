// The h3 event and handler surface: how a contract-bearing handler is
// registered with the platform, and how the platform's event reaches the rest
// of the runtime. Everything else in this package sees `RuntimeEvent`, never
// `H3Event` — that one alias is what keeps the h3 major version a detail of
// this directory. See README.md for where each call goes.
import { defineHandler } from 'h3'
import type { EventHandlerRequestShape, H3Event } from 'h3'

export type RuntimeEvent = H3Event
export type RuntimeContractEvent<Request extends EventHandlerRequestShape> = H3Event<Request>

export function defineRuntimeHandler<RESPONSE>(
  handler: (event: RuntimeEvent) => RESPONSE,
): (event: RuntimeEvent) => RESPONSE {
  return defineHandler(handler as never) as unknown as (event: RuntimeEvent) => RESPONSE
}

/**
 * The incoming request as a Web `Request` for the handler context. On h3 v2
 * this is a property read: `event.req` is already a `Request`, so the v1
 * `toWebRequest(event)` call this replaced is gone rather than renamed.
 */
export function getRuntimeWebRequest(event: RuntimeEvent): Request {
  return event.req
}

/**
 * Reads the incoming request's HTTP method (e.g. `'GET'`). Used by the
 * method-dispatch runtime (endpoint-methods.ts) to pick which declared
 * method's sub-handler runs.
 */
export function getRuntimeMethod(event: RuntimeEvent): string {
  return event.req.method
}
