export type IdempotencyStoredResponse = {
  status: number
  /** Whether the endpoint response has a JSON body (as opposed to 204/empty output). */
  hasBody: boolean
  /** JSON text produced by the core runtime. Empty only when `hasBody` is false. */
  serializedBody: string
  headers?: Readonly<Record<string, string>>
}

export type IdempotencyClaimInput = {
  /** Opaque, library-generated digest of endpoint identity, scope, and client key. */
  storageKey: string
  /** Opaque, library-generated digest of the canonical request projection. */
  fingerprint: string
  /** Opaque fencing token proposed for a newly acquired in-flight record. */
  lease: string
  /** Duration for which a newly acquired in-flight lease remains claimable. */
  leaseTtlMs: number
}

export type IdempotencyClaimResult =
  | { outcome: 'acquired' }
  | { outcome: 'in-flight'; retryAfterMs?: number }
  | { outcome: 'completed'; response: IdempotencyStoredResponse }
  | { outcome: 'conflict' }

export type IdempotencyCompleteInput = {
  storageKey: string
  fingerprint: string
  lease: string
  response: IdempotencyStoredResponse
  replayTtlMs: number
}

export type IdempotencyReleaseInput = {
  storageKey: string
  fingerprint: string
  lease: string
}

export type IdempotencyLeaseMutationResult = { outcome: 'applied' } | { outcome: 'lease-lost' }

/**
 * Atomic persistence boundary for Idempotency-Key replay protection.
 *
 * Implementations own their clock and expiry cleanup. `claim` must compare the
 * fingerprint and replace expired records in one atomic decision. `complete`
 * and `release` must mutate only the in-flight record matching all of
 * `storageKey`, `fingerprint`, and `lease`.
 */
export interface IdempotencyStorage {
  /**
   * Atomically claims an absent/expired record. Retrying the same input lease
   * against the matching in-flight record must also return `acquired`.
   */
  claim(input: IdempotencyClaimInput): Promise<IdempotencyClaimResult>
  complete(input: IdempotencyCompleteInput): Promise<IdempotencyLeaseMutationResult>
  release(input: IdempotencyReleaseInput): Promise<IdempotencyLeaseMutationResult>
}

export type MemoryIdempotencyStorageOptions = {
  /** Development/test clock override. Defaults to `Date.now`. */
  now?: () => number
  /** Maximum live records retained by the process-local development store. */
  maxEntries?: number
}

type MemoryIdempotencyRecord = MemoryInFlightRecord | MemoryCompletedRecord

type MemoryInFlightRecord = {
  state: 'in-flight'
  fingerprint: string
  lease: string
  expiresAt: number
}

type MemoryCompletedRecord = {
  state: 'completed'
  fingerprint: string
  response: IdempotencyStoredResponse
  expiresAt: number
}

const maximumIdempotencyTtlMs = 2_147_483_647

export function canonicalizeIdempotencyValue(value: unknown): string {
  try {
    const normalized = normalizeIdempotencyJsonValue(value, new WeakSet())
    const serialized = JSON.stringify(normalized)

    if (serialized === undefined) {
      throw new TypeError('Top-level value is not JSON serializable')
    }

    return serialized
  } catch (error) {
    throw new TypeError('Idempotency value must be JSON serializable', { cause: error })
  }
}

export async function createIdempotencyFingerprint(value: unknown): Promise<string> {
  return createSha256Digest(canonicalizeIdempotencyValue(value))
}

export async function createIdempotencyStorageKey(input: {
  method: string
  routeTemplate: string
  scope: string
  key: string
}): Promise<string> {
  return createSha256Digest(
    canonicalizeIdempotencyValue([
      'nuxt-endpoints:idempotency:v1',
      input.method.toLowerCase(),
      input.routeTemplate,
      input.scope,
      input.key,
    ]),
  )
}

export function validateIdempotencyTtl(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximumIdempotencyTtlMs) {
    throw new TypeError(`${name} must be an integer between 1 and ${maximumIdempotencyTtlMs}`)
  }

  return value
}

export function hasHttpControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit <= 31 || codeUnit === 127) {
      return true
    }
  }
  return false
}

/**
 * Process-local storage for development and tests only.
 *
 * Records are not shared across processes and disappear on restart. Production
 * applications must provide a durable `IdempotencyStorage` implementation.
 */
export function createMemoryIdempotencyStorage(
  options: MemoryIdempotencyStorageOptions = {},
): IdempotencyStorage {
  const records = new Map<string, MemoryIdempotencyRecord>()
  const readNow = options.now ?? Date.now
  const maxEntries = validateMemoryStorageMaxEntries(options.maxEntries ?? 10_000)

  return {
    async claim(input) {
      const now = getMemoryStorageTime(readNow)
      const leaseTtlMs = validateIdempotencyTtl(input.leaseTtlMs, 'leaseTtlMs')
      sweepExpiredMemoryRecords(records, now)
      const existing = getUnexpiredRecord(records, input.storageKey, now)

      if (!existing) {
        if (records.size >= maxEntries) {
          throw new Error(`Memory idempotency storage cannot exceed ${maxEntries} live records`)
        }
        records.set(input.storageKey, {
          state: 'in-flight',
          fingerprint: input.fingerprint,
          lease: input.lease,
          expiresAt: now + leaseTtlMs,
        })
        return { outcome: 'acquired' }
      }

      if (existing.fingerprint !== input.fingerprint) {
        return { outcome: 'conflict' }
      }

      if (existing.state === 'completed') {
        return {
          outcome: 'completed',
          response: copyStoredResponse(existing.response),
        }
      }

      if (existing.lease === input.lease) {
        return { outcome: 'acquired' }
      }

      return {
        outcome: 'in-flight',
        retryAfterMs: Math.max(0, Math.ceil(existing.expiresAt - now)),
      }
    },

    async complete(input) {
      const now = getMemoryStorageTime(readNow)
      const replayTtlMs = validateIdempotencyTtl(input.replayTtlMs, 'replayTtlMs')
      sweepExpiredMemoryRecords(records, now)
      const existing = getUnexpiredRecord(records, input.storageKey, now)

      if (!matchesMemoryLease(existing, input)) {
        return { outcome: 'lease-lost' }
      }

      records.set(input.storageKey, {
        state: 'completed',
        fingerprint: input.fingerprint,
        response: copyStoredResponse(input.response),
        expiresAt: now + replayTtlMs,
      })
      return { outcome: 'applied' }
    },

    async release(input) {
      const now = getMemoryStorageTime(readNow)
      sweepExpiredMemoryRecords(records, now)
      const existing = getUnexpiredRecord(records, input.storageKey, now)

      if (!matchesMemoryLease(existing, input)) {
        return { outcome: 'lease-lost' }
      }

      records.delete(input.storageKey)
      return { outcome: 'applied' }
    },
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function normalizeIdempotencyJsonValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Non-finite numbers are not JSON serializable')
    }
    return value
  }
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${typeof value} values are not JSON serializable`)
  }
  if (ancestors.has(value)) {
    throw new TypeError('Circular values are not JSON serializable')
  }

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => normalizeIdempotencyJsonValue(item, ancestors) ?? null)
    }

    if (!isPlainRecord(value)) {
      const toJson = 'toJSON' in value && typeof value.toJSON === 'function' ? value.toJSON : null
      if (!toJson) {
        throw new TypeError(`${value.constructor?.name || 'Object'} is not JSON serializable`)
      }
      return normalizeIdempotencyJsonValue(toJson.call(value), ancestors)
    }

    const normalized: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const key of Object.keys(value).sort()) {
      const item = normalizeIdempotencyJsonValue(value[key], ancestors)
      if (item !== undefined) {
        normalized[key] = item
      }
    }
    return normalized
  } finally {
    ancestors.delete(value)
  }
}

async function createSha256Digest(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function getMemoryStorageTime(readNow: () => number): number {
  const now = readNow()
  if (!Number.isFinite(now)) {
    throw new TypeError('Memory idempotency storage clock must return a finite number')
  }
  return now
}

function validateMemoryStorageMaxEntries(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('Memory idempotency storage maxEntries must be a positive integer')
  }
  return value
}

function sweepExpiredMemoryRecords(
  records: Map<string, MemoryIdempotencyRecord>,
  now: number,
): void {
  for (const [storageKey, record] of records) {
    if (record.expiresAt <= now) {
      records.delete(storageKey)
    }
  }
}

function getUnexpiredRecord(
  records: Map<string, MemoryIdempotencyRecord>,
  storageKey: string,
  now: number,
): MemoryIdempotencyRecord | undefined {
  const existing = records.get(storageKey)
  if (!existing) {
    return undefined
  }

  if (existing.expiresAt <= now) {
    records.delete(storageKey)
    return undefined
  }

  return existing
}

function matchesMemoryLease(
  record: MemoryIdempotencyRecord | undefined,
  input: IdempotencyReleaseInput,
): record is MemoryInFlightRecord {
  return (
    record?.state === 'in-flight' &&
    record.fingerprint === input.fingerprint &&
    record.lease === input.lease
  )
}

function copyStoredResponse(response: IdempotencyStoredResponse): IdempotencyStoredResponse {
  return {
    status: response.status,
    hasBody: response.hasBody,
    serializedBody: response.serializedBody,
    ...(response.headers ? { headers: { ...response.headers } } : {}),
  }
}

// Request-time capabilities whose presence is tracked in the endpoint marker.
// Startup validation requires all three from the endpoint execution layer or
// the central policy. This is deliberately not the complete list of options
// forbidden in a serializable route contract.
export const idempotencyRuntimeOptionKeys = ['storage', 'scope', 'authorization'] as const
export type IdempotencyRuntimeOptionKey = (typeof idempotencyRuntimeOptionKeys)[number]

// Every option that belongs to request-time execution rather than the portable
// route contract. TypeScript rejects these through RouteContractIdempotency;
// definition-time validation uses the same list so JavaScript cannot have a
// value accepted at build time and silently discarded by defineRouteHandler.
export const idempotencyRouteContractForbiddenOptionKeys = [
  ...idempotencyRuntimeOptionKeys,
  'fingerprint',
  'replayStatuses',
  'leaseTtlMs',
  'replayTtlMs',
] as const
export type IdempotencyRouteContractForbiddenOptionKey =
  (typeof idempotencyRouteContractForbiddenOptionKeys)[number]
