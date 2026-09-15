// Low-level assembly primitives remain implementation details. Tests import
// them through this private barrel so the package's public runtime surface only
// exposes the canonical authoring API.
export * from '../src/runtime'
export {
  defineEndpoint as defineEndpointContract,
  defineEndpointHandler,
} from '../src/runtime/endpoint'
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
