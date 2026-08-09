import { GrammyError } from 'grammy'
import { addMessage, addNudge, listActiveUsers, updateUser } from '../db/repo.js'
import { considerNudge, skipReason } from './nudge.js'
import { config } from '../config.js'
import { describeError, logger } from '../util/log.js'
import type { KeyedMutex } from '../util/mutex.js'

const log = logger('proactive')

export interface SchedulerDeps {
  /** Same mutex the bot uses, so a nudge never races an inbound message. */
  mutex: KeyedMutex
  send: (chatId: string, text: string) => Promise<void>
}

export async function runTick(deps: SchedulerDeps): Promise<void> {
  const users = listActiveUsers()
  log.debug(`tick: ${users.length} active traveler(s)`)

  for (const user of users) {
    const skip = skipReason(user)
    if (skip) {
      log.debug(`${user.id}: skipped (${skip})`)
      continue
    }

    try {
      await deps.mutex.run(user.id, async () => {
        const nudge = await considerNudge(user)
        if (!nudge) {
          log.info(`${user.id}: considered, nothing worth sending`)
          return
        }

        await deps.send(user.id, nudge.message)
        addNudge(user.id, nudge.topic, nudge.message)
        addMessage(user.id, 'assistant', nudge.message, true)
        log.info(`${user.id}: sent nudge [${nudge.topic}]`)
      })
    } catch (error) {
      // A traveler who blocked the bot would otherwise cost a model call every
      // tick, forever. Nothing we send will ever arrive, so stop trying.
      if (error instanceof GrammyError && (error.error_code === 403 || error.error_code === 400)) {
        updateUser(user.id, { paused: true })
        log.warn(`${user.id}: unreachable (${error.error_code}), pausing proactive messages`)
        continue
      }
      log.error(`${user.id}: nudge failed`, describeError(error))
    }
  }
}

export function startScheduler(deps: SchedulerDeps): () => void {
  const intervalMs = Math.max(config.tickMinutes, 1) * 60_000
  log.info(`proactive engine running every ${config.tickMinutes}m`)

  let running = false
  const tick = () => {
    if (running) {
      log.warn('previous tick still running, skipping this one')
      return
    }
    running = true
    void runTick(deps)
      .catch((error) => log.error('tick failed', describeError(error)))
      .finally(() => {
        running = false
      })
  }

  const handle = setInterval(tick, intervalMs)
  // Don't fire immediately on boot - let the process settle first.
  const warmup = setTimeout(tick, 30_000)

  return () => {
    clearInterval(handle)
    clearTimeout(warmup)
  }
}
