import type { NitroRouteHandlerDescriptor } from '../nitro-route-handlers'
import type { EndpointIdempotencyMetadata } from '../runtime/contract'

// Mirrors `resolver.resolve` (from `@nuxt/kit`'s `createResolver`), which every
// codegen builder receives so generated import specifiers stay relative to
// the module's own location rather than to whichever file calls the builder.
export type ResolvePath = (path: string) => string

// The composed handler shape build-time endpoint detection produces (a Nitro
// route handler augmented with the operation name and idempotency metadata
// read from its `.idempotency()` call, once known). Every codegen builder
// consumes this same shape, so it is the one export both module.ts and the
// generators below share instead of redeclaring it.
export type EndpointRouteHandler = Omit<NitroRouteHandlerDescriptor, 'route' | 'method'> & {
  route: string
  method: string
  operation?: string
  idempotency?: EndpointIdempotencyMetadata
  // Set when the route declares a stream response, so the generated client
  // config can tell the fetcher not to parse this route's body.
  stream?: true
  // Set when this entry was expanded from a `defineEndpointMethods()` group
  // (a single method-suffix-free route file declaring several methods): its
  // `handler` file exports one dispatcher whose per-method contract and
  // handler-return types live under `__endpoint_contracts__`/
  // `__endpoint_method_handler_returns__` rather than the single-endpoint
  // `__endpoint_contract__`/`__endpoint_handler_return__` markers, so codegen
  // needs to know which accessor shape to generate.
  methodGroup?: true
}

// The slice of `ResolvedEndpointsModuleOptions` (module.ts) the type/client
// generators need: just the client feature toggles, not query or OpenAPI
// settings. Kept narrow so codegen has no reason to import module.ts's option
// type back, which would create a cycle; `resolvedOptions` in module.ts is a
// structural superset and is passed in as-is.
export type EndpointClientCodegenOptions = {
  client: {
    result: boolean
    raw: boolean
    effect: boolean
  }
}
