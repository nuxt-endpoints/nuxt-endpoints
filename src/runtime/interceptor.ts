// The extension point between request validation and handler execution. A
// wrapper receives the same validated context the handler does and decides
// whether the handler runs at all, which is what replaying an idempotent
// response requires. It sits after validation by necessity: a fingerprint has
// to be taken from coerced values, and a wrapper that ran earlier would only
// see raw input. Validation failures are shaped by `onValidationError`
// instead, in validation-error.ts.
import type { EndpointContext, EndpointDefinition } from './contract'

/**
 * A single shape for every outcome `DefinedEndpoint.handler()` can produce:
 * an ordinary success body, a Problem Details payload, or a replayed
 * response. `applyEndpointResponse` is the only place that turns this into
 * actual `event` mutations, so a wrapper never touches the event directly.
 */
export type EndpointRuntimeResponse = {
  status: number
  body: unknown
  headers?: Readonly<Record<string, string>>
  explicitStatus: boolean
}

/** Runs the rest of the chain, ending in the endpoint's own handler. */
export type EndpointHandlerNext = () => Promise<EndpointRuntimeResponse>

/**
 * Wraps handler execution. Return `next()` to run the handler, or return a
 * response without calling it to answer on its behalf — that omission is the
 * mechanism, not an accident, and is how a recorded response is replayed.
 * Because the wrapper is an ordinary function, `try`/`finally` around `next()`
 * is how work that must survive a thrown handler is expressed.
 */
export type EndpointHandlerWrapper<DEFINITION extends EndpointDefinition> = (
  context: EndpointContext<DEFINITION>,
  next: EndpointHandlerNext,
) => Promise<EndpointRuntimeResponse>
