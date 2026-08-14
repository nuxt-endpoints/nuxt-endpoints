import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { useRuntimeConfig } from 'nitropack/runtime'

export interface PlaygroundUser {
  id: number
  name: string
  createdAt: string
}

interface PlaygroundUserRow {
  id: number
  name: string
  created_at: string
}

let database: Database.Database | undefined

export function getPlaygroundDatabase() {
  if (database) return database

  const runtimeConfig = useRuntimeConfig()
  const { playgroundDatabasePath: databasePath } = runtimeConfig as typeof runtimeConfig & {
    playgroundDatabasePath: string
  }
  mkdirSync(dirname(databasePath), { recursive: true })

  const db = new Database(databasePath)
  database = db
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS playground_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `)

  const seed = db.transaction(() => {
    const row = db.prepare('SELECT COUNT(*) AS count FROM playground_users').get() as {
      count: number
    }
    if (row.count !== 0) return

    const insert = db.prepare('INSERT INTO playground_users (name) VALUES (?)')
    insert.run('Ada Lovelace')
    insert.run('Grace Hopper')
  })
  seed.immediate()

  return db
}

function mapUser(row: PlaygroundUserRow): PlaygroundUser {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  }
}

export function listPlaygroundUsers(): PlaygroundUser[] {
  const rows = getPlaygroundDatabase()
    .prepare('SELECT id, name, created_at FROM playground_users ORDER BY id DESC')
    .all() as PlaygroundUserRow[]

  return rows.map(mapUser)
}

export function createPlaygroundUser(name: string): PlaygroundUser {
  const db = getPlaygroundDatabase()
  const result = db.prepare('INSERT INTO playground_users (name) VALUES (?)').run(name)
  const row = db
    .prepare('SELECT id, name, created_at FROM playground_users WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as PlaygroundUserRow

  return mapUser(row)
}
