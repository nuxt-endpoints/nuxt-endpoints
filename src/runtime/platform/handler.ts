// The h3 event and handler surface: how a contract-bearing handler is
// registered with the platform, and how the platform's event reaches the rest
// of the runtime. Everything else in this package sees `RuntimeEvent`, never
// `H3Event` — that one alias is what keeps the h3 major version a detail of
// this directory. See README.md for where each call goes on h3 v2.
import * as h3 from 'h3'
import type { EventHandlerRequest, H3Event } from 'h3'

export type RuntimeEvent = H3Event
export type RuntimeRouteEvent<Body, Query, Headers> = H3Event<{
  body: Body
  query: Extract<Query, NonNullable<EventHandlerRequest['query']>>
  headers: Headers
}>

export function defineRuntimeHandler<RESPONSE>(
  handler: (event: RuntimeEvent) => RESPONSE,
): (event: RuntimeEvent) => RESPONSE {
  return h3.defineEventHandler(handler as never) as unknown as (event: RuntimeEvent) => RESPONSE
}

/**
 * Normalizes the platform event into a Web `Request` for the handler context.
 * Nitro 3 exposes the web request on the event. The legacy H3 module provides
 * the conversion on Nitro 2.
 */
export function getRuntimeWebRequest(event: RuntimeEvent): Request {
  if (event.req instanceof Request) return event.req
  return (h3 as typeof h3 & { toWebRequest(event: RuntimeEvent): Request }).toWebRequest(event)
}

/**
 * Reads the incoming request's HTTP method (e.g. `'GET'`). Used by the
 * method-dispatch runtime (endpoint-methods.ts) to pick which declared
 * method's sub-handler runs.
 */
export function getRuntimeMethod(event: RuntimeEvent): string {
  return event.method
}
