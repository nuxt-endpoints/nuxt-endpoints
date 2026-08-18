// Internal seam between request validation and handler execution: it carries
// already-validated values and lets an interceptor decide whether/how the
// handler runs, and how its result is turned into a wire response. Not part
// of the public API yet (see `src/runtime/index.ts`) until this extension
// point design has an external consumer beyond `.idempotency()` and has
// stabilized enough to bring upstream to h3.
import type { EndpointContext, EndpointDefinition } from './contract'
import type { RuntimeEvent } from './h3-adapter'

/**
 * A single shape for every outcome `DefinedEndpoint.handler()` can produce:
 * an ordinary success body, a Problem Details payload, or a replayed
 * response. `applyEndpointResponse` is the only place that turns this into
 * actual `event` mutations, so interceptors never touch the event directly.
 */
export type EndpointRuntimeResponse = {
  status: number
  body: unknown
  headers?: Readonly<Record<string, string>>
  explicitStatus: boolean
}

export type EndpointInterceptorContext<DEFINITION extends EndpointDefinition> = {
  event: RuntimeEvent
  context: EndpointContext<DEFINITION>
}

export type EndpointInterceptorNext = () => Promise<EndpointRuntimeResponse>

export type EndpointInterceptor<DEFINITION extends EndpointDefinition> = (
  context: EndpointInterceptorContext<DEFINITION>,
  next: EndpointInterceptorNext,
) => Promise<EndpointRuntimeResponse>
