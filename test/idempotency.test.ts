import { describe, expect, it } from 'vitest'
import { createMemoryIdempotencyStorage } from './internal-runtime'
import type { IdempotencyStorage, IdempotencyStoredResponse } from './internal-runtime'
import {
  canonicalizeIdempotencyValue,
  createIdempotencyFingerprint,
  createIdempotencyStorageKey,
  validateIdempotencyTtl,
} from '../src/runtime/idempotency'

const storedResponse: IdempotencyStoredResponse = {
  status: 201,
  hasBody: true,
  serializedBody: '{"id":1}',
  headers: { location: '/api/items/1' },
}

function claimInput(overrides: Partial<Parameters<IdempotencyStorage['claim']>[0]> = {}) {
  return {
    storageKey: 'storage-key',
    fingerprint: 'fingerprint-a',
    lease: 'lease-a',
    leaseTtlMs: 1_000,
    ...overrides,
  }
}

function completeInput(overrides: Partial<Parameters<IdempotencyStorage['complete']>[0]> = {}) {
  return {
    storageKey: 'storage-key',
    fingerprint: 'fingerprint-a',
    lease: 'lease-a',
    response: storedResponse,
    replayTtlMs: 1_000,
    ...overrides,
  }
}

function releaseInput(overrides: Partial<Parameters<IdempotencyStorage['release']>[0]> = {}) {
  return {
    storageKey: 'storage-key',
    fingerprint: 'fingerprint-a',
    lease: 'lease-a',
    ...overrides,
  }
}

describe('idempotency canonicalization and digests', () => {
  it('canonicalizes nested object keys while preserving array order', async () => {
    expect(
      canonicalizeIdempotencyValue({
        query: { page: 2, filter: { role: 'admin', active: true } },
        body: { tags: ['a', 'b'] },
      }),
    ).toBe(
      canonicalizeIdempotencyValue({
        body: { tags: ['a', 'b'] },
        query: { filter: { active: true, role: 'admin' }, page: 2 },
      }),
    )

    expect(canonicalizeIdempotencyValue({ tags: ['a', 'b'] })).not.toBe(
      canonicalizeIdempotencyValue({ tags: ['b', 'a'] }),
    )
  })

  it('uses JSON serialization semantics and rejects non-serializable projections', async () => {
    expect(canonicalizeIdempotencyValue({ omitted: undefined, kept: null })).toBe('{"kept":null}')
    expect(canonicalizeIdempotencyValue({ at: new Date('2026-07-21T00:00:00.000Z') })).toBe(
      '{"at":"2026-07-21T00:00:00.000Z"}',
    )
    expect(() => canonicalizeIdempotencyValue({ value: 1n })).toThrow(/serializable/i)
    expect(() => canonicalizeIdempotencyValue({ value: Number.NaN })).toThrow(/serializable/i)
    expect(() => canonicalizeIdempotencyValue({ value: Number.POSITIVE_INFINITY })).toThrow(
      /serializable/i,
    )
    expect(() => canonicalizeIdempotencyValue({ value: new Map([['amount', 100]]) })).toThrow(
      /serializable/i,
    )
    expect(() => canonicalizeIdempotencyValue({ value: new Set(['a']) })).toThrow(/serializable/i)

    const circular: { self?: unknown } = {}
    circular.self = circular
    expect(() => canonicalizeIdempotencyValue(circular)).toThrow(/serializable/i)
  })

  it('rejects the default fingerprint projection when a multipart body carries a File', () => {
    // Pins current behavior: a media-type-map endpoint with a
    // `multipart/form-data` member can put a `File` into `context.body`, and
    // the default fingerprint projection (`{ params, query, body }`) must
    // keep rejecting it rather than silently changing what gets hashed.
    const body = { upload: new File(['contents'], 'upload.txt', { type: 'text/plain' }) }

    let caught: unknown
    try {
      canonicalizeIdempotencyValue({ params: undefined, query: undefined, body })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(TypeError)
    expect((caught as TypeError).message).toMatch(/serializable/i)
    expect((caught as TypeError).cause).toBeInstanceOf(TypeError)
    expect(((caught as TypeError).cause as TypeError).message).toBe('File is not JSON serializable')
  })

  it('preserves JSON object keys that have prototype semantics in JavaScript', () => {
    const withProtoKey = JSON.parse('{"__proto__":{"amount":100}}') as unknown

    expect(canonicalizeIdempotencyValue(withProtoKey)).toBe('{"__proto__":{"amount":100}}')
    expect(canonicalizeIdempotencyValue(withProtoKey)).not.toBe(canonicalizeIdempotencyValue({}))
  })

  it('creates stable SHA-256 fingerprints', async () => {
    const first = await createIdempotencyFingerprint({ body: { amount: 100, currency: 'JPY' } })
    const reordered = await createIdempotencyFingerprint({
      body: { currency: 'JPY', amount: 100 },
    })
    const changed = await createIdempotencyFingerprint({
      body: { currency: 'USD', amount: 100 },
    })

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(reordered).toBe(first)
    expect(changed).not.toBe(first)
  })

  it('separates storage keys by method, route, trusted scope, and client key', async () => {
    const base = {
      method: 'POST',
      routeTemplate: '/api/points',
      scope: 'tenant-a:user-1',
      key: 'client-key',
    }
    const storageKey = await createIdempotencyStorageKey(base)

    expect(storageKey).toMatch(/^[a-f0-9]{64}$/)
    await expect(createIdempotencyStorageKey({ ...base, method: 'PATCH' })).resolves.not.toBe(
      storageKey,
    )
    await expect(
      createIdempotencyStorageKey({ ...base, routeTemplate: '/api/refunds' }),
    ).resolves.not.toBe(storageKey)
    await expect(
      createIdempotencyStorageKey({ ...base, scope: 'tenant-b:user-1' }),
    ).resolves.not.toBe(storageKey)
    await expect(createIdempotencyStorageKey({ ...base, key: 'other-key' })).resolves.not.toBe(
      storageKey,
    )

    const delimiterCollisionA = await createIdempotencyStorageKey({
      method: 'POST',
      routeTemplate: '/api/a:b',
      scope: 'c',
      key: 'd',
    })
    const delimiterCollisionB = await createIdempotencyStorageKey({
      method: 'POST',
      routeTemplate: '/api/a',
      scope: 'b:c',
      key: 'd',
    })
    expect(delimiterCollisionA).not.toBe(delimiterCollisionB)
  })

  it('validates portable millisecond TTLs', async () => {
    expect(validateIdempotencyTtl(1, 'leaseTtlMs')).toBe(1)
    expect(validateIdempotencyTtl(2_147_483_647, 'replayTtlMs')).toBe(2_147_483_647)

    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
      expect(() => validateIdempotencyTtl(invalid, 'leaseTtlMs')).toThrow(/leaseTtlMs/)
    }
  })
})

describe('development memory idempotency storage', () => {
  it('claims once and reports matching in-flight and conflict outcomes atomically', async () => {
    let now = 1_000
    const storage = createMemoryIdempotencyStorage({ now: () => now })

    await expect(storage.claim(claimInput())).resolves.toEqual({ outcome: 'acquired' })
    await expect(storage.claim(claimInput())).resolves.toEqual({ outcome: 'acquired' })
    await expect(storage.claim(claimInput({ lease: 'lease-b' }))).resolves.toEqual({
      outcome: 'in-flight',
      retryAfterMs: 1_000,
    })
    await expect(
      storage.claim(claimInput({ fingerprint: 'fingerprint-b', lease: 'lease-b' })),
    ).resolves.toEqual({ outcome: 'conflict' })

    now += 250
    await expect(storage.claim(claimInput({ lease: 'lease-b' }))).resolves.toEqual({
      outcome: 'in-flight',
      retryAfterMs: 750,
    })
  })

  it('allows exactly one lease to win concurrent claims', async () => {
    const storage = createMemoryIdempotencyStorage({ now: () => 1_000 })

    const results = await Promise.all(
      ['lease-a', 'lease-b', 'lease-c'].map((lease) => storage.claim(claimInput({ lease }))),
    )

    expect(results.filter((result) => result.outcome === 'acquired')).toHaveLength(1)
    expect(results.filter((result) => result.outcome === 'in-flight')).toHaveLength(2)
  })

  it('completes with the active lease and replays a defensive response copy', async () => {
    const storage = createMemoryIdempotencyStorage({ now: () => 1_000 })
    const response = {
      ...storedResponse,
      headers: { ...storedResponse.headers },
    }

    await storage.claim(claimInput())
    await expect(
      storage.complete(completeInput({ response, replayTtlMs: 10_000 })),
    ).resolves.toEqual({ outcome: 'applied' })

    ;(response.headers as Record<string, string>).location = '/mutated'

    await expect(storage.claim(claimInput({ lease: 'lease-b' }))).resolves.toEqual({
      outcome: 'completed',
      response: storedResponse,
    })
    await expect(
      storage.claim(claimInput({ fingerprint: 'fingerprint-b', lease: 'lease-b' })),
    ).resolves.toEqual({ outcome: 'conflict' })
  })

  it('rejects stale completion after lease expiry even before another claim', async () => {
    let now = 1_000
    const storage = createMemoryIdempotencyStorage({ now: () => now })

    await storage.claim(claimInput({ leaseTtlMs: 100 }))
    now = 1_100

    await expect(storage.complete(completeInput())).resolves.toEqual({ outcome: 'lease-lost' })
    await expect(storage.release(releaseInput())).resolves.toEqual({ outcome: 'lease-lost' })
  })

  it('fences an old lease after an expired record is claimed again', async () => {
    let now = 1_000
    const storage = createMemoryIdempotencyStorage({ now: () => now })

    await storage.claim(claimInput({ lease: 'old', leaseTtlMs: 100 }))
    now = 1_100
    await expect(storage.claim(claimInput({ lease: 'new' }))).resolves.toEqual({
      outcome: 'acquired',
    })

    await expect(storage.complete(completeInput({ lease: 'old' }))).resolves.toEqual({
      outcome: 'lease-lost',
    })
    await expect(storage.release(releaseInput({ lease: 'old' }))).resolves.toEqual({
      outcome: 'lease-lost',
    })
    await expect(storage.complete(completeInput({ lease: 'new' }))).resolves.toEqual({
      outcome: 'applied',
    })
  })

  it('allows a fresh claim after completed replay expiry', async () => {
    let now = 1_000
    const storage = createMemoryIdempotencyStorage({ now: () => now })

    await storage.claim(claimInput())
    await storage.complete(completeInput({ replayTtlMs: 100 }))
    now = 1_100

    await expect(storage.claim(claimInput({ lease: 'lease-b' }))).resolves.toEqual({
      outcome: 'acquired',
    })
  })

  it('releases only the matching unexpired lease', async () => {
    const storage = createMemoryIdempotencyStorage({ now: () => 1_000 })

    await storage.claim(claimInput())
    await expect(storage.release(releaseInput({ lease: 'other' }))).resolves.toEqual({
      outcome: 'lease-lost',
    })
    await expect(storage.release(releaseInput({ fingerprint: 'fingerprint-b' }))).resolves.toEqual({
      outcome: 'lease-lost',
    })
    await expect(storage.release(releaseInput())).resolves.toEqual({ outcome: 'applied' })
    await expect(storage.claim(claimInput({ lease: 'lease-b' }))).resolves.toEqual({
      outcome: 'acquired',
    })
  })

  it('requires storage key, fingerprint, lease, and in-flight state for mutations', async () => {
    const storage = createMemoryIdempotencyStorage({ now: () => 1_000 })

    await storage.claim(claimInput())

    await expect(
      storage.complete(completeInput({ fingerprint: 'fingerprint-b' })),
    ).resolves.toEqual({ outcome: 'lease-lost' })
    await expect(storage.complete(completeInput({ storageKey: 'other-key' }))).resolves.toEqual({
      outcome: 'lease-lost',
    })
    await expect(storage.complete(completeInput())).resolves.toEqual({ outcome: 'applied' })
    await expect(storage.complete(completeInput())).resolves.toEqual({ outcome: 'lease-lost' })
    await expect(storage.release(releaseInput())).resolves.toEqual({ outcome: 'lease-lost' })
  })

  it('sweeps unrelated expired records before enforcing the development limit', async () => {
    let now = 1_000
    const storage = createMemoryIdempotencyStorage({ now: () => now, maxEntries: 1 })

    await storage.claim(claimInput({ storageKey: 'expired', leaseTtlMs: 100 }))
    await expect(storage.claim(claimInput({ storageKey: 'blocked' }))).rejects.toThrow(
      /cannot exceed 1/,
    )

    now = 1_100
    await expect(storage.claim(claimInput({ storageKey: 'replacement' }))).resolves.toEqual({
      outcome: 'acquired',
    })
  })
})

describe('fingerprint determinability at definition time', () => {
  it('rejects an idempotent endpoint with no body contract and no fingerprint', async () => {
    const { defineEndpoint } = await import('./internal-runtime')

    // Without a body contract the default projection cannot see a body the
    // handler reads itself, and the two payloads would share a fingerprint.
    expect(() => defineEndpoint({ operation: 'publish' }).idempotency({ required: true })).toThrow(
      /needs an explicit fingerprint/,
    )
  })

  it('rejects the same single-define endpoint at definition time', async () => {
    const { defineEndpoint } = await import('./internal-runtime')

    // The merged form routes its `idempotency` slot through `.idempotency()`,
    // so the assertion fires before the handler is ever attached.
    expect(() =>
      defineEndpoint({
        operation: 'publishMerged',
        idempotency: { required: true },
        handler: () => ({ published: true }),
      }),
    ).toThrow(/needs an explicit fingerprint/)
  })

  it('accepts one once the author states what identifies the request', async () => {
    const { defineEndpoint } = await import('./internal-runtime')
    const { z } = await import('zod')

    expect(() =>
      defineEndpoint({ operation: 'publish', params: z.object({ id: z.string() }) }).idempotency({
        required: true,
        fingerprint: ({ params }) => ({ params }),
      }),
    ).not.toThrow()

    // An operation that genuinely takes no input says so.
    expect(() =>
      defineEndpoint({ operation: 'ping' }).idempotency({
        required: true,
        fingerprint: () => ({}),
      }),
    ).not.toThrow()
  })

  it('needs nothing extra when a body contract is declared', async () => {
    const { defineEndpoint } = await import('./internal-runtime')
    const { z } = await import('zod')

    expect(() =>
      defineEndpoint({ body: z.object({ amount: z.number() }) }).idempotency({ required: true }),
    ).not.toThrow()
  })
})
