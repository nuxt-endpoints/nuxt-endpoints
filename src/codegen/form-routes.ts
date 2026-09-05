import type { EndpointRouteHandler } from './types'

/** One page URL's native-form target, as the bridge middleware needs it. */
export type EndpointFormRouteEntry = {
  target: string
  enctype: string
  redirect?: string
}

// Pure builder: returns the `#nuxt-endpoints/form-routes` content
// (module.ts registers it through `addServerTemplate`).
//
// This is deliberately a plain object rather than the handler manifest's
// shape: the bridge runs on every request, so it must not import anything it
// might not need. Nothing here loads a handler module.
export function generateEndpointFormRoutes(handlers: readonly EndpointRouteHandler[]): string {
  const routes: Record<string, EndpointFormRouteEntry> = {}

  for (const handler of handlers) {
    if (!handler.form || handler.form.method !== 'post' || !handler.route) {
      continue
    }
    const existing = routes[handler.form.action]
    if (existing) {
      throw new Error(
        `[nuxt-endpoints] Two endpoints declare \`form.action: ${JSON.stringify(handler.form.action)}\`: ${existing.target} and ${handler.route}. A page URL can back one endpoint, because a native submission carries nothing that would tell them apart.`,
      )
    }
    routes[handler.form.action] = {
      target: handler.route,
      enctype: handler.form.enctype,
      ...(handler.form.redirect ? { redirect: handler.form.redirect } : {}),
    }
  }

  return `export const formRoutes = ${JSON.stringify(routes, null, 2)}\n`
}
