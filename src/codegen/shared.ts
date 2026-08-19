import type { EndpointRouteHandler } from './types'

// The runtime-facing route config shape embedded (as a `JSON.stringify`'d `as
// const` literal) in both the plain client (`endpoints.ts`) and the query
// adapter client (`endpoints-query.ts`). Factored out so the two generators
// build it identically rather than duplicating the same `.map()`.
export type EndpointRouteConfigEntry = {
  path: string
  method: string
  operation?: string
  idempotency?: { headerName: string; required: boolean }
  stream?: true
}

export function toEndpointRouteConfigEntries(
  handlers: readonly EndpointRouteHandler[],
): EndpointRouteConfigEntry[] {
  return handlers.map((handler) => ({
    path: handler.route,
    method: handler.method,
    ...(handler.operation ? { operation: handler.operation } : {}),
    ...(handler.idempotency
      ? {
          idempotency: {
            headerName: handler.idempotency.headerName,
            required: handler.idempotency.required,
          },
        }
      : {}),
    ...(handler.stream ? { stream: true as const } : {}),
  }))
}

// Windows path separators must not leak into generated import specifiers.
export function toImportPath(path: string): string {
  return path.replace(/\\/g, '/')
}
