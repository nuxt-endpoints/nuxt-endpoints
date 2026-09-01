// Legacy authoring primitives remain implementation details: `defineRouteHandler`
// is built on them, but Nitro's contract macro recognizes no other identifier, so
// a route authored through one of them would be served without its contract ever
// reaching the build. Tests import them through this private barrel so the
// package's public runtime surface only exposes the canonical API.
export * from '../src/runtime'
export { defineEndpoint, defineEndpointHandler } from '../src/runtime/endpoint'
export type {
  DefinedEndpoint,
  EndpointEventHandler,
  EndpointHandlerSuccessBody,
  EndpointRuntimeOptions,
} from '../src/runtime/endpoint'
export {
  defineEndpointMethodHandlers,
  defineEndpointMethods,
} from '../src/runtime/endpoint-methods'
export type { EndpointMethodMember } from '../src/runtime/endpoint-methods'
