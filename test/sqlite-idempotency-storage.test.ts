import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'vitest'
import type { IdempotencyStorage, IdempotencyStoredResponse } from '../src/runtime'
import { createSqliteIdempotencyStorage } from '../playground/server/utils/sqlite-idempotency-storage'

const databases: Database.Database[] = []
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createDatabase(filename = ':memory:') {
  const database = new Database(filename)
  database.pragma('busy_timeout = 5000')
  databases.push(database)
  return database
}

function createSharedDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), 'nuxt-endpoints-sqlite-'))
  temporaryDirectories.push(directory)
  return join(directory, 'idempotency.sqlite')
}

function createClaimWorker(filename: string, lease: string) {
  const worker = new Worker(new URL('./fixtures/sqlite-idempotency-worker.ts', import.meta.url), {
    workerData: { filename, lease },
  })
  const ready = new Promise<void>((resolve, reject) => {
    worker.once('error', reject)
    worker.on('message', (message: { type?: string }) => {
      if (message.type === 'ready') resolve()
    })
  })
  const result = new Promise<{
    lease: string
    result: Awaited<ReturnType<IdempotencyStorage['claim']>>
  }>((resolve, reject) => {
    worker.once('error', reject)
    worker.on(
      'message',
      (message: {
        type?: string
        lease: string
        result: Awaited<ReturnType<IdempotencyStorage['claim']>>
      }) => {
        if (message.type === 'result') resolve(message)
      },
    )
  })

  return { worker, ready, result }
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

const storedResponse: IdempotencyStoredResponse = {
  status: 201,
  hasBody: true,
  serializedBody: '{"id":1}',
  headers: { location: '/api/sqlite/users/1' },
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

describe('playground SQLite idempotency storage conformance', () => {
  it('allows one owner across truly concurrent connections and preserves uncertain retries', async () => {
    const filename = createSharedDatabasePath()
    const setupDatabase = createDatabase(filename)
    createSqliteIdempotencyStorage(setupDatabase, { now: () => 1_000 })
    setupDatabase.close()
    databases.splice(databases.indexOf(setupDatabase), 1)

    const workerA = createClaimWorker(filename, 'lease-a')
    const workerB = createClaimWorker(filename, 'lease-b')
    await Promise.all([workerA.ready, workerB.ready])
    workerA.worker.postMessage('claim')
    workerB.worker.postMessage('claim')

    const results = await Promise.all([workerA.result, workerB.result])
    expect(results.map(({ result }) => result.outcome).sort()).toEqual(['acquired', 'in-flight'])

    const winner = results.find(({ result }) => result.outcome === 'acquired')
    expect(winner).toBeDefined()
    if (!winner) throw new Error('Concurrent SQLite claims did not produce an owner')

    const verificationStorage = createSqliteIdempotencyStorage(createDatabase(filename), {
      now: () => 1_000,
    })
    await expect(verificationStorage.claim(claimInput({ lease: winner.lease }))).resolves.toEqual({
      outcome: 'acquired',
    })
  })

  it('completes and replays every stored response field', async () => {
    const storage = createSqliteIdempotencyStorage(createDatabase(), { now: () => 1_000 })

    await expect(storage.claim(claimInput())).resolves.toEqual({ outcome: 'acquired' })
    await expect(storage.complete(completeInput())).resolves.toEqual({ outcome: 'applied' })
    await expect(storage.claim(claimInput({ lease: 'lease-b' }))).resolves.toEqual({
      outcome: 'completed',
      response: storedResponse,
    })

    const emptyResponse: IdempotencyStoredResponse = {
      status: 204,
      hasBody: false,
      serializedBody: '',
    }
    await storage.claim(claimInput({ storageKey: 'empty', lease: 'empty-lease' }))
    await storage.complete(
      completeInput({
        storageKey: 'empty',
        lease: 'empty-lease',
        response: emptyResponse,
      }),
    )
    await expect(
      storage.claim(claimInput({ storageKey: 'empty', lease: 'empty-replay' })),
    ).resolves.toEqual({ outcome: 'completed', response: emptyResponse })

    const nullResponse: IdempotencyStoredResponse = {
      status: 200,
      hasBody: true,
      serializedBody: 'null',
    }
    await storage.claim(claimInput({ storageKey: 'null', lease: 'null-lease' }))
    await storage.complete(
      completeInput({ storageKey: 'null', lease: 'null-lease', response: nullResponse }),
    )
    await expect(
      storage.claim(claimInput({ storageKey: 'null', lease: 'null-replay' })),
    ).resolves.toEqual({ outcome: 'completed', response: nullResponse })
  })

  it('conflicts on a different fingerprint in-flight and after completion', async () => {
    const storage = createSqliteIdempotencyStorage(createDatabase(), { now: () => 1_000 })

    await storage.claim(claimInput())
    await expect(
      storage.claim(claimInput({ fingerprint: 'fingerprint-b', lease: 'lease-b' })),
    ).resolves.toEqual({ outcome: 'conflict' })

    await storage.complete(completeInput())
    await expect(
      storage.claim(claimInput({ fingerprint: 'fingerprint-b', lease: 'lease-b' })),
    ).resolves.toEqual({ outcome: 'conflict' })
  })

  it('fences an expired lease and permits a fresh owner and replay expiry', async () => {
    let now = 1_000
    const storage = createSqliteIdempotencyStorage(createDatabase(), { now: () => now })

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
    await expect(
      storage.complete(completeInput({ lease: 'new', replayTtlMs: 100 })),
    ).resolves.toEqual({ outcome: 'applied' })

    now = 1_200
    await expect(storage.claim(claimInput({ lease: 'after-replay' }))).resolves.toEqual({
      outcome: 'acquired',
    })
  })

  it('releases only the matching live lease', async () => {
    const storage = createSqliteIdempotencyStorage(createDatabase(), { now: () => 1_000 })

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
})
