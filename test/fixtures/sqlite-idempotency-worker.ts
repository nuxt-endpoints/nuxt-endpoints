import Database from 'better-sqlite3'
import { parentPort, workerData } from 'node:worker_threads'
import { createSqliteIdempotencyStorage } from '../../playground/server/utils/sqlite-idempotency-storage.ts'

interface WorkerInput {
  filename: string
  lease: string
}

const input = workerData as WorkerInput
const database = new Database(input.filename)
database.pragma('busy_timeout = 5000')
const storage = createSqliteIdempotencyStorage(database, { now: () => 1_000 })

parentPort?.postMessage({ type: 'ready' })

parentPort?.once('message', async (message: unknown) => {
  if (message !== 'claim') return

  const result = await storage.claim({
    storageKey: 'storage-key',
    fingerprint: 'fingerprint-a',
    lease: input.lease,
    leaseTtlMs: 1_000,
  })
  database.close()
  parentPort?.postMessage({ type: 'result', lease: input.lease, result })
  parentPort?.close()
})
