import { config } from './config.js'
import { runMigrations } from './db/index.js'
import { createBot } from './bot/telegram.js'
import { startScheduler } from './proactive/scheduler.js'
import { KeyedMutex } from './util/mutex.js'
import { describeError, logger } from './util/log.js'

const log = logger('roadio')

async function main(): Promise<void> {
  runMigrations()

  // One mutex shared by every entry point: a scheduled nudge must never
  // interleave with an inbound message for the same traveler.
  const mutex = new KeyedMutex()

  if (!config.telegramBotToken) {
    // Web-only mode: the bot and the proactive engine both stay down. Once the
    // HTTP server lands it will hold the event loop open and this process will
    // serve the web app. Until then there is genuinely nothing to run, and
    // exiting loudly beats idling in a way that looks like a hang.
    log.info('TELEGRAM_BOT_TOKEN not set - the Telegram bot and proactive engine are disabled')
    log.info('Nothing left to run: the HTTP server is not built yet. Exiting.')
    return
  }

  const { bot, send } = createBot(config.telegramBotToken, mutex)
  const stopScheduler = startScheduler({ mutex, send })

  const shutdown = async (signal: string) => {
    log.info(`${signal} received, shutting down`)
    stopScheduler()
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
