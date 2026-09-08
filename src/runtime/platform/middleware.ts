// Progressive-enhancement middleware is the only runtime feature that needs
// to run before Nuxt's renderer and dispatch another route internally. Keep
// the h3 v1 / Nitro 2 mechanics here so the form bridge itself stays shared
// with the Nuxt 5 line.
import { defineEventHandler, getRequestURL, sendRedirect, setResponseStatus } from 'h3'
import type { RuntimeEvent } from './handler'

export type RuntimeMiddlewareResult = unknown

export type RuntimeMiddlewareNext = () => Promise<RuntimeMiddlewareResult>

export type RuntimeMiddleware = (
  event: RuntimeEvent,
  next: RuntimeMiddlewareNext,
) => Promise<RuntimeMiddlewareResult>

export function defineRuntimeMiddleware(middleware: RuntimeMiddleware): unknown {
  // h3 v1 continues to the following middleware when this handler resolves to
  // undefined. The synthetic next keeps the shared bridge API identical to
  // h3 v2 without pretending v1 has a continuation callback.
  return defineEventHandler((event) => middleware(event, async () => undefined))
}

export function getRuntimePathname(event: RuntimeEvent): string {
  return getRequestURL(event).pathname
}

export function runtimeRedirect(
  event: RuntimeEvent,
  location: string,
  status: number,
): Promise<void> {
  return sendRedirect(event, location, status as never)
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
  setResponseStatus(event, status)
  return next()
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
  if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
    // Nitro 2's node-local dispatcher does not serialize FormData or add its
    // boundary. A Web Request does both; buffer that encoded representation
    // before handing it to the local dispatcher.
    const encoded = new Request(`http://nuxt-endpoints.local${path}`, init)
    return useNitroApp().localFetch(path, {
      ...init,
      body: await encoded.arrayBuffer(),
      headers: encoded.headers,
    } as never)
  }
  return useNitroApp().localFetch(path, init as never)
}
