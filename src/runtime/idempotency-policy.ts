import type { EndpointDefinition } from './contract'
import type { EndpointIdempotencyContext, IdempotencyAuthorizationDelegation } from './endpoint'
import { validateIdempotencyTtl } from './idempotency'
import type { IdempotencyStorage } from './idempotency'

type MaybePromise<VALUE> = VALUE | Promise<VALUE>

type PolicyContext = EndpointIdempotencyContext<EndpointDefinition>

/**
 * Central, app-wide defaults for the runtime portions of `.idempotency()`
 * (storage, scope, authorization, TTLs). Contract-shaping options
 * (headerName, required, replayStatuses, fingerprint) stay endpoint-only and
 * are not part of this policy.
 */
export type EndpointIdempotencyPolicy = {
  /**
   * Returns the durable store that records a completed response, so a retry
   * carrying the same `Idempotency-Key` receives that response instead of
   * running the handler again. It must return an already-connected adapter
   * rather than opening a connection per request.
   */
  storage: (context: PolicyContext) => MaybePromise<IdempotencyStorage>
  /**
   * Returns the trusted identity a key belongs to — typically the
   * authenticated user or tenant — so one caller's key can never address
   * another's recorded response. Derive it from server state only.
   */
  scope: (context: PolicyContext) => MaybePromise<string>
  authorization:
    | IdempotencyAuthorizationDelegation
    | ((context: PolicyContext) => MaybePromise<void>)
  /** How long one in-flight execution may hold its claim. */
  leaseTtlMs?: number
  /** How long a completed response stays replayable. */
  replayTtlMs?: number
}

export function defineIdempotencyPolicy(
  policy: EndpointIdempotencyPolicy,
): EndpointIdempotencyPolicy {
  if (policy.leaseTtlMs !== undefined) {
    validateIdempotencyTtl(policy.leaseTtlMs, 'leaseTtlMs')
  }
  if (policy.replayTtlMs !== undefined) {
    validateIdempotencyTtl(policy.replayTtlMs, 'replayTtlMs')
  }

  return policy
}
