import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { config } from '../config.js'
import { logger } from '../util/log.js'
import * as schema from './schema.js'

const log = logger('db')

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true })

const sqlite = new Database(config.dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })

export function runMigrations(): void {
  const folder = path.resolve('drizzle')
  if (!fs.existsSync(folder)) {
    throw new Error(
      `Migration folder ${folder} is missing. Run \`npm run db:generate\` to create it.`,
    )
  }
  migrate(db, { migrationsFolder: folder })
  log.info(`schema up to date (${config.dbPath})`)
}
