// Progressive-enhancement middleware is the only runtime feature that needs
// to run before Nuxt's renderer and dispatch another route internally. Keep
// the platform's middleware and dispatch mechanics here so the bridge can
// handle a submission the same way on either server.
import * as h3 from 'h3'
import type { RuntimeEvent } from './handler'

export type RuntimeMiddlewareResult = unknown

export type RuntimeMiddlewareNext = () => Promise<RuntimeMiddlewareResult>

export type RuntimeMiddleware = (
  event: RuntimeEvent,
  next: RuntimeMiddlewareNext,
) => Promise<RuntimeMiddlewareResult>

export function defineRuntimeMiddleware(middleware: RuntimeMiddleware): unknown {
  // H3 1 has no such export. A runtime lookup lets both packages be bundled.
  const defineMiddleware: unknown = Reflect.get(h3, 'defineMiddleware')
  if (typeof defineMiddleware === 'function') {
    return defineMiddleware(middleware)
  }
  // h3 v1 continues to the following middleware when this handler resolves to
  // undefined. The synthetic next keeps the shared bridge API identical to
  // h3 v2 without pretending v1 has a continuation callback.
  return h3.defineEventHandler((event) => middleware(event, async () => undefined))
}

export function getRuntimePathname(event: RuntimeEvent): string {
  return h3.getRequestURL(event).pathname
}

export async function runtimeRedirect(
  event: RuntimeEvent,
  location: string,
  status: number,
): Promise<unknown> {
  return h3.sendRedirect(event, location, status as never)
}

/**
 * Nitro 2 renders the page on this same event after middleware falls through,
 * and preserves the status already written to the event response.
 */
export async function continueRuntimeRendering(
  event: RuntimeEvent,
  next: RuntimeMiddlewareNext,
  status: number,
): Promise<RuntimeMiddlewareResult> {
  h3.setResponseStatus(event, status)
  const rendered = await next()
  if (rendered instanceof Response && rendered.ok) {
    // Nitro 3's renderer returns a Web Response with its own status.
    return new Response(rendered.body, { status, headers: rendered.headers })
  }
  return rendered
}

export async function runtimeServerFetch(
  _event: RuntimeEvent,
  path: string,
  init: RequestInit,
): Promise<Response> {
  // event.fetch proxies the caller's headers before applying `init`. For a
  // multipart body that would preserve the caller's old boundary after the
  // bridge rebuilt FormData. Nitro's raw localFetch starts a clean request and
  // lets undici generate the matching boundary.
  const { useNitroApp } = await import('nitropack/runtime')
  const app = useNitroApp()
  if ('fetch' in app && typeof app.fetch === 'function') {
    return app.fetch(new Request(`http://nuxt-endpoints.local${path}`, init))
  }
  if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
    // Nitro 2's node-local dispatcher does not serialize FormData or add its
    // boundary. A Web Request does both; buffer that encoded representation
    // before handing it to the local dispatcher.
    const encoded = new Request(`http://nuxt-endpoints.local${path}`, init)
    return app.localFetch(path, {
      ...init,
      body: await encoded.arrayBuffer(),
      headers: encoded.headers,
    } as never)
  }
  return app.localFetch(path, init as never)
}
