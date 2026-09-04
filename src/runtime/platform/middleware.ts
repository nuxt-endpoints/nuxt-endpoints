// Middleware and internal dispatch: everything the progressive-enhancement
// bridge needs from the platform. It runs before route matching, calls another
// route inside the same server, and answers the browser with a redirect - three
// things no other part of this runtime does, and all three are h3/Nitro APIs.
//
// `next` is the reason this is h3 v2 only: v1 handlers were given no
// continuation, so a middleware could not wrap the renderer in its own event.
// See README.md and docs/progressive-enhancement.md.
import { defineMiddleware, redirect } from 'h3'
import { serverFetch } from 'nitro/app'
import type { RuntimeEvent } from './handler'

/** What a middleware may hand back: a response, or nothing to fall through. */
export type RuntimeMiddlewareResult = unknown

export type RuntimeMiddleware = (
  event: RuntimeEvent,
  next: () => Promise<RuntimeMiddlewareResult>,
) => Promise<RuntimeMiddlewareResult>

export function defineRuntimeMiddleware(middleware: RuntimeMiddleware): unknown {
  return defineMiddleware(middleware as never)
}

/** The path a request was addressed to, without query or origin. */
export function getRuntimePathname(event: RuntimeEvent): string {
  return event.url.pathname
}

export function runtimeRedirect(location: string, status: number): Response {
  return redirect(location, status as never) as unknown as Response
}

/**
 * Calls a route inside this server. Nitro routes internally when the path
 * starts with `/`, and builds a real `Request`, so a `FormData` body gets its
 * own multipart boundary rather than inheriting the caller's.
 */
export function runtimeServerFetch(path: string, init: RequestInit): Promise<Response> {
  return serverFetch(path, init as never) as Promise<Response>
}
