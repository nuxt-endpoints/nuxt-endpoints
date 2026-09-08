import type { EndpointFormRouteMetadata, EndpointRouteHandler } from './types'

// The runtime-facing route config shape embedded (as a `JSON.stringify`'d `as
// const` literal) in the generated client (`endpoints.ts`).
export type EndpointRouteConfigEntry = {
  name?: string
  path: string
  method: string
  idempotency?: { headerName: string; required: boolean }
  mediaResponse?: true
  form?: EndpointFormRouteMetadata
  pagination?: EndpointRouteHandler['pagination']
}

export function toEndpointRouteConfigEntries(
  handlers: readonly EndpointRouteHandler[],
): EndpointRouteConfigEntry[] {
  return handlers.map((handler) => ({
    ...(handler.name !== undefined ? { name: handler.name } : {}),
    path: handler.route,
    method: handler.method,
    ...(handler.idempotency
      ? {
          idempotency: {
            headerName: handler.idempotency.headerName,
            required: handler.idempotency.required,
          },
        }
      : {}),
    ...(handler.mediaResponse ? { mediaResponse: true as const } : {}),
    ...(handler.form ? { form: handler.form } : {}),
    ...(handler.pagination ? { pagination: handler.pagination } : {}),
  }))
}

// Windows path separators must not leak into generated import specifiers.
export function toImportPath(path: string): string {
  return path.replace(/\\/g, '/')
}
