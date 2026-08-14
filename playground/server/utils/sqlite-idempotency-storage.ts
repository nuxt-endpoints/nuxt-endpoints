import type Database from 'better-sqlite3'
import type {
  IdempotencyClaimInput,
  IdempotencyClaimResult,
  IdempotencyStorage,
  IdempotencyStoredResponse,
} from '../../../src/runtime'

interface SqliteIdempotencyStorageOptions {
  now?: () => number
}

interface IdempotencyRow {
  state: 'in-flight' | 'completed'
  fingerprint: string
  lease: string | null
  expires_at: number
  status: number | null
  has_body: number | null
  serialized_body: string | null
  response_headers: string | null
}

let playgroundStorage: Promise<IdempotencyStorage> | undefined

export function getPlaygroundIdempotencyStorage(): Promise<IdempotencyStorage> {
  if (!playgroundStorage) {
    playgroundStorage = import('./database').then(({ getPlaygroundDatabase }) =>
      createSqliteIdempotencyStorage(getPlaygroundDatabase()),
    )
  }
  return playgroundStorage
}

export function createSqliteIdempotencyStorage(
  database: Database.Database,
  options: SqliteIdempotencyStorageOptions = {},
): IdempotencyStorage {
  const now = options.now ?? Date.now

  database.exec(`
    CREATE TABLE IF NOT EXISTS endpoint_idempotency (
      storage_key TEXT PRIMARY KEY,
      state TEXT NOT NULL CHECK (state IN ('in-flight', 'completed')),
      fingerprint TEXT NOT NULL,
      lease TEXT,
      expires_at INTEGER NOT NULL,
      status INTEGER,
      has_body INTEGER,
      serialized_body TEXT,
      response_headers TEXT,
      CHECK (
        (state = 'in-flight' AND lease IS NOT NULL AND status IS NULL AND has_body IS NULL AND serialized_body IS NULL)
        OR
        (state = 'completed' AND lease IS NULL AND status IS NOT NULL AND has_body IS NOT NULL AND serialized_body IS NOT NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS endpoint_idempotency_expiry_idx
      ON endpoint_idempotency (expires_at);
  `)

  const claim = database.transaction((input: IdempotencyClaimInput): IdempotencyClaimResult => {
    const timestamp = now()
    database.prepare('DELETE FROM endpoint_idempotency WHERE expires_at <= ?').run(timestamp)
    const existing = database
      .prepare(
        `SELECT state, fingerprint, lease, expires_at, status, has_body, serialized_body, response_headers
         FROM endpoint_idempotency
         WHERE storage_key = ?`,
      )
      .get(input.storageKey) as IdempotencyRow | undefined

    if (!existing) {
      database
        .prepare(
          `INSERT INTO endpoint_idempotency (
             storage_key, state, fingerprint, lease, expires_at,
             status, has_body, serialized_body, response_headers
           ) VALUES (?, 'in-flight', ?, ?, ?, NULL, NULL, NULL, NULL)
           ON CONFLICT(storage_key) DO UPDATE SET
             state = 'in-flight',
             fingerprint = excluded.fingerprint,
             lease = excluded.lease,
             expires_at = excluded.expires_at,
             status = NULL,
             has_body = NULL,
             serialized_body = NULL,
             response_headers = NULL`,
        )
        .run(input.storageKey, input.fingerprint, input.lease, timestamp + input.leaseTtlMs)
      return { outcome: 'acquired' }
    }

    if (existing.fingerprint !== input.fingerprint) {
      return { outcome: 'conflict' }
    }

    if (existing.state === 'completed') {
      return {
        outcome: 'completed',
        response: readStoredResponse(existing),
      }
    }

    if (existing.lease === input.lease) {
      return { outcome: 'acquired' }
    }

    return {
      outcome: 'in-flight',
      retryAfterMs: Math.max(0, Math.ceil(existing.expires_at - timestamp)),
    }
  })

  return {
    async claim(input) {
      return claim.immediate(input)
    },

    async complete(input) {
      const timestamp = now()
      const result = database
        .prepare(
          `UPDATE endpoint_idempotency
           SET state = 'completed',
               lease = NULL,
               expires_at = ?,
               status = ?,
               has_body = ?,
               serialized_body = ?,
               response_headers = ?
           WHERE storage_key = ?
             AND state = 'in-flight'
             AND fingerprint = ?
             AND lease = ?
             AND expires_at > ?`,
        )
        .run(
          timestamp + input.replayTtlMs,
          input.response.status,
          input.response.hasBody ? 1 : 0,
          input.response.serializedBody,
          input.response.headers ? JSON.stringify(input.response.headers) : null,
          input.storageKey,
          input.fingerprint,
          input.lease,
          timestamp,
        )

      return result.changes === 1 ? { outcome: 'applied' } : { outcome: 'lease-lost' }
    },

    async release(input) {
      const timestamp = now()
      const result = database
        .prepare(
          `DELETE FROM endpoint_idempotency
           WHERE storage_key = ?
             AND state = 'in-flight'
             AND fingerprint = ?
             AND lease = ?
             AND expires_at > ?`,
        )
        .run(input.storageKey, input.fingerprint, input.lease, timestamp)

      return result.changes === 1 ? { outcome: 'applied' } : { outcome: 'lease-lost' }
    },
  }
}

function readStoredResponse(row: IdempotencyRow): IdempotencyStoredResponse {
  if (row.status === null || row.has_body === null || row.serialized_body === null) {
    throw new Error('Completed SQLite idempotency record is missing response fields')
  }

  return {
    status: row.status,
    hasBody: row.has_body === 1,
    serializedBody: row.serialized_body,
    headers: row.response_headers
      ? (JSON.parse(row.response_headers) as Record<string, string>)
      : undefined,
  }
}
