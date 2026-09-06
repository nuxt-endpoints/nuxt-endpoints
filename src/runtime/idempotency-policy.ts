import type { EndpointDefinition } from './contract'
import type {
  EndpointIdempotencyContext,
  IdempotencyAuthorizationDelegation,
  IdempotencyGlobalScope,
  IdempotencyPublicAuthorization,
} from './endpoint'
import { validateIdempotencyTtl } from './idempotency'
import type { IdempotencyStorage } from './idempotency'

type MaybePromise<VALUE> = VALUE | Promise<VALUE>

type PolicyContext = EndpointIdempotencyContext<EndpointDefinition>

/**
 * Central, app-wide defaults for idempotency runtime behavior. Header name and
 * requiredness stay in the route contract; fingerprints, replay statuses, and
 * TTLs may also be overridden in the route runtime map.
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
   * authenticated user or tenant — so one caller's key cannot address
   * another's recorded response. Derive it from server state only. Use
   * `global` only for a public operation with no caller-specific response.
   */
  scope: IdempotencyGlobalScope | ((context: PolicyContext) => MaybePromise<string>)
  /**
   * `public` means authorization is unnecessary; `middleware` means it already
   * ran. A callback runs for normal requests and replays, even without a key.
   */
  authorization:
    | IdempotencyAuthorizationDelegation
    | IdempotencyPublicAuthorization
    | ((context: PolicyContext) => MaybePromise<void>)
  /** How long one in-flight execution may hold its claim. */
  leaseTtlMs?: number
  /** How long a completed response stays replayable. */
  replayTtlMs?: number
}

export function defineIdempotencyPolicy(
  policy: EndpointIdempotencyPolicy,
): EndpointIdempotencyPolicy {
  validateEndpointIdempotencyPolicy(policy)
  return policy
}

export function validateEndpointIdempotencyPolicy(
  policy: unknown,
): asserts policy is EndpointIdempotencyPolicy {
  if (typeof policy !== 'object' || policy === null || Array.isArray(policy)) {
    throw new TypeError('Idempotency policy must be an object')
  }
  const candidate = policy as Record<string, unknown>
  const unknown = Object.keys(candidate).find(
    (key) => !['storage', 'scope', 'authorization', 'leaseTtlMs', 'replayTtlMs'].includes(key),
  )
  if (unknown) throw new TypeError(`Unknown idempotency policy option \`${unknown}\``)
  if (typeof candidate.storage !== 'function') {
    throw new TypeError('Idempotency policy storage must be a function')
  }
  if (candidate.scope !== 'global' && typeof candidate.scope !== 'function') {
    throw new TypeError('Idempotency policy scope must be "global" or a function')
  }
  if (
    candidate.authorization !== 'public' &&
    candidate.authorization !== 'middleware' &&
    typeof candidate.authorization !== 'function'
  ) {
    throw new TypeError(
      'Idempotency policy authorization must be "public", "middleware", or a function',
    )
  }
  if (candidate.leaseTtlMs !== undefined) {
    if (typeof candidate.leaseTtlMs !== 'number') {
      throw new TypeError('Idempotency policy leaseTtlMs must be a number')
    }
    validateIdempotencyTtl(candidate.leaseTtlMs, 'leaseTtlMs')
  }
  if (candidate.replayTtlMs !== undefined) {
    if (typeof candidate.replayTtlMs !== 'number') {
      throw new TypeError('Idempotency policy replayTtlMs must be a number')
    }
    validateIdempotencyTtl(candidate.replayTtlMs, 'replayTtlMs')
  }
}
