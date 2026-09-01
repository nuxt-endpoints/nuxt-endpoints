import type { NitroRouteHandlerDescriptor } from '../nitro-route-handlers'
import type { EndpointIdempotencyMetadata } from '../runtime/contract'

// Mirrors `resolver.resolve` (from `@nuxt/kit`'s `createResolver`), which every
// codegen builder receives so generated import specifiers stay relative to
// the module's own location rather than to whichever file calls the builder.
export type ResolvePath = (path: string) => string

// The composed handler shape build-time endpoint detection produces (a Nitro
// route handler augmented with idempotency metadata
// read from its `.idempotency()` call, once known). Every codegen builder
// consumes this same shape, so it is the one export both module.ts and the
// generators below share instead of redeclaring it.
export type EndpointRouteHandler = Omit<NitroRouteHandlerDescriptor, 'route' | 'method'> & {
  route: string
  method: string
  idempotency?: EndpointIdempotencyMetadata
  // Set when the route declares a media response, so the generated client
  // config can tell the fetcher not to parse this route's body.
  mediaResponse?: true
  // Set when this entry was expanded from one method-suffix-free route file.
  // Nitro initially contributes a `default` return for that dispatcher;
  // module.ts removes it and contributes one schema entry per method.
  methodGroup?: true
}

// The slice of `ResolvedEndpointsModuleOptions` (module.ts) the type/client
// generators need: just the client feature toggles, not query or OpenAPI
// settings. Kept narrow so codegen has no reason to import module.ts's option
// type back, which would create a cycle; `resolvedOptions` in module.ts is a
// structural superset and is passed in as-is.
export type EndpointClientCodegenOptions = {
  client: {
    raw: boolean
  }
}
