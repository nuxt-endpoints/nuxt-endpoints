// The platform seam, as one import site. Code outside this directory imports
// from './platform' and names no h3 or Nitro API directly; which platform
// call answers each function is this directory's concern. README.md maps the
// files and predicts what h3 v2 / Nitro 3 absorb.
export { validateRouteContractRequest, validateRouteContractResponse } from 'h3'
export type {
  RouteContract,
  RouteContractRequestResult,
  RouteContractResponseResult,
  RouteContractValidator,
} from 'h3'
export { defineRuntimeHandler, getRuntimeMethod, getRuntimeWebRequest } from './handler'
export type { RuntimeContractEvent, RuntimeEvent } from './handler'
export {
  getRuntimeQuery,
  getRuntimeRequestHeaders,
  readRuntimeBinaryBody,
  readRuntimeBody,
  readRuntimeFormData,
  readRuntimeTextBody,
} from './request'
export { createRuntimeError, setRuntimeResponseHeaders, setRuntimeResponseStatus } from './response'
export type { RuntimeHttpErrorOptions } from './response'
export type { EndpointWireValue } from './wire'
