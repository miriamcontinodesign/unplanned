import { runMigrations } from './db/index.js'
import { startServer } from './http/server.js'
import { KeyedMutex } from './util/mutex.js'
import { describeError, logger } from './util/log.js'

const log = logger('roadio')

async function main(): Promise<void> {
  runMigrations()

  // One mutex shared by every entry point so two turns for the same traveler
  // never interleave their writes.
  const mutex = new KeyedMutex()

  const stopServer = startServer(mutex)

  process.once('SIGINT', () => {
    stopServer()
    process.exit(0)
  })
  process.once('SIGTERM', () => {
    stopServer()
    process.exit(0)
  })
}

main().catch((error) => {
  log.error('fatal', describeError(error))
  process.exit(1)
})
