import { config } from './config.js'
import { runMigrations } from './db/index.js'
import { createBot } from './bot/telegram.js'
import { startServer } from './http/server.js'
import { startScheduler } from './proactive/scheduler.js'
import { KeyedMutex } from './util/mutex.js'
import { describeError, logger } from './util/log.js'

const log = logger('roadio')

async function main(): Promise<void> {
  runMigrations()

  // One mutex shared by every entry point: a web chat turn, an inbound Telegram
  // message and a scheduled nudge must never interleave for the same traveler.
  const mutex = new KeyedMutex()

  const stopServer = startServer(mutex)

  if (!config.telegramBotToken) {
    log.info('TELEGRAM_BOT_TOKEN not set - the Telegram bot and proactive engine are disabled')
    process.once('SIGINT', () => {
      stopServer()
      process.exit(0)
    })
    process.once('SIGTERM', () => {
      stopServer()
      process.exit(0)
    })
    return
  }

  const { bot, send } = createBot(config.telegramBotToken, mutex)
  const stopScheduler = startScheduler({ mutex, send })

  const shutdown = async (signal: string) => {
    log.info(`${signal} received, shutting down`)
    stopScheduler()
    stopServer()
    await bot.stop()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))

  log.info(`starting bot (model ${config.model})`)
  await bot.start({
    onStart: (info) => log.info(`connected as @${info.username}`),
  })
}

main().catch((error) => {
  log.error('fatal', describeError(error))
  process.exit(1)
})
