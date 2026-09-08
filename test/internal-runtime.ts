// Legacy authoring primitives remain implementation details while the main
// branch is backed by Nitro 2 and H3 1. Tests import them through this private
// barrel so the package's public runtime surface only exposes the canonical
// defineEndpoint API.
export * from '../src/runtime'
export {
  defineEndpoint as defineEndpointContract,
  defineEndpointHandler,
} from '../src/runtime/endpoint'
export type { EndpointEventHandler } from '../src/runtime/endpoint'
export {
  defineEndpointMethodHandlers,
  defineEndpointMethods,
} from '../src/runtime/endpoint-methods'
export type { EndpointMethodMember } from '../src/runtime/endpoint-methods'
