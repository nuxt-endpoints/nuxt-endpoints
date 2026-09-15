// Middleware and internal dispatch: everything the progressive-enhancement
// bridge needs from the platform. It runs before route matching, calls another
// route inside the same server, and answers the browser with a redirect - three
// things no other part of this runtime does, and all three are h3/Nitro APIs.
//
// h3 v2 exposes `next`, allowing this line to wrap the rendered Response. The
// Nuxt 4 adapter keeps the same API and uses h3 v1's undefined fallthrough.
// See docs/progressive-enhancement.md.
import { defineMiddleware, redirect } from 'h3'
import { serverFetch } from 'nitro/app'
import type { RuntimeEvent } from './handler'

/** What a middleware may hand back: a response, or nothing to fall through. */
export type RuntimeMiddlewareResult = unknown

export type RuntimeMiddlewareNext = () => Promise<RuntimeMiddlewareResult>

export type RuntimeMiddleware = (
  event: RuntimeEvent,
  next: RuntimeMiddlewareNext,
) => Promise<RuntimeMiddlewareResult>

export function defineRuntimeMiddleware(middleware: RuntimeMiddleware): unknown {
  return defineMiddleware(middleware as never)
}

/** The path a request was addressed to, without query or origin. */
export function getRuntimePathname(event: RuntimeEvent): string {
  return event.url.pathname
}

export function runtimeRedirect(_event: RuntimeEvent, location: string, status: number): Response {
  return redirect(location, status as never) as unknown as Response
}

/** Continues into Nuxt's renderer and restores the endpoint failure status. */
export async function continueRuntimeRendering(
  _event: RuntimeEvent,
  next: RuntimeMiddlewareNext,
  status: number,
): Promise<RuntimeMiddlewareResult> {
  const rendered = await next()
  if (!(rendered instanceof Response)) {
    return rendered
  }
  return new Response(rendered.body, {
    status,
    statusText: rendered.statusText,
    headers: rendered.headers,
  })
}

/**
 * Calls a route inside this server. Nitro routes internally when the path
 * starts with `/`, and builds a real `Request`, so a `FormData` body gets its
 * own multipart boundary rather than inheriting the caller's.
 */
export function runtimeServerFetch(
  _event: RuntimeEvent,
  path: string,
  init: RequestInit,
): Promise<Response> {
  return serverFetch(path, init as never) as Promise<Response>
}
