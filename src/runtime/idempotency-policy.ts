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
  storage: (context: PolicyContext) => MaybePromise<IdempotencyStorage>
  scope: (context: PolicyContext) => MaybePromise<string>
  authorization:
    | IdempotencyAuthorizationDelegation
    | ((context: PolicyContext) => MaybePromise<void>)
  leaseTtlMs?: number
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
