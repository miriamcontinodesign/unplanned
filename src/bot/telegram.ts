import fs from 'node:fs'
import path from 'node:path'
import { Bot, type Context } from 'grammy'
import { config } from '../config.js'
import { describeError, logger } from '../util/log.js'
import { KeyedMutex } from '../util/mutex.js'
import { localDate } from '../util/time.js'
import {
  addJournalEntry,
  addMessage,
  currentStay,
  getOrCreateUserByTelegram,
  listOpenPlans,
  listPreferences,
  updateUser,
} from '../db/repo.js'
import { extractAndApply } from '../llm/extract.js'
import { generateReply, transcriptText } from '../llm/reply.js'
import { generateJournal } from '../llm/journal.js'
import { captionPhoto } from '../llm/caption.js'
import { describeStay } from '../llm/state.js'
import { RefusalError } from '../llm/client.js'

const log = logger('telegram')

/** Telegram rejects anything over 4096 characters. */
const MAX_MESSAGE = 4000

export function createBot(botToken: string, mutex: KeyedMutex) {
  const bot = new Bot(botToken)

  const send = async (chatId: string, text: string): Promise<void> => {
    for (const chunk of chunkText(text)) {
      await bot.api.sendMessage(chatId, chunk)
    }
  }

  bot.catch((error) => {
    log.error('unhandled bot error', describeError(error.error))
  })

  // ------------------------------------------------------------- commands

  bot.command('start', async (ctx) => {
    const user = ensureUser(ctx)
    await ctx.reply(
      [
        "I'm Roadio. Tell me where you are and I'll keep track of your trip.",
        '',
        'Something like "just landed in Lima, staying in Miraflores until Sunday" is enough to get going. From then on I know where you are, so ask me anything - and I\'ll message you unprompted when something is genuinely worth doing.',
        '',
        'Commands: /status, /journal, /pause, /resume, /quiet 21-8, /limit 3',
      ].join('\n'),
    )
    log.info(`${user.id}: started`)
  })

  bot.command('status', async (ctx) => {
    const user = ensureUser(ctx)
    const stay = currentStay(user.id)
    const plans = listOpenPlans(user.id)
    const prefs = listPreferences(user.id)

    const lines = [
      stay ? `Location: ${describeStay(stay)}` : 'Location: not set yet',
      stay?.lodgingName || stay?.lodgingArea
        ? `Staying: ${[stay.lodgingName, stay.lodgingArea].filter(Boolean).join(', ')}`
        : null,
      stay?.departureDate ? `Leaving: ${stay.departureDate}` : null,
      stay?.timezone ? `Local date: ${localDate(stay.timezone)} (${stay.timezone})` : null,
      '',
      plans.length > 0 ? `Plans: ${plans.map((p) => p.title).join('; ')}` : 'Plans: none recorded',
      prefs.length > 0 ? `Preferences: ${prefs.map((p) => p.text).join('; ')}` : 'Preferences: none recorded',
      '',
      user.paused
        ? 'Proactive suggestions: paused'
        : `Proactive suggestions: on, up to ${user.maxNudgesPerDay}/day, quiet ${pad(user.quietStartHour)}:00-${pad(user.quietEndHour)}:00`,
    ].filter((line) => line !== null)

    await ctx.reply(lines.join('\n'))
  })

  bot.command('pause', async (ctx) => {
    const user = ensureUser(ctx)
    updateUser(user.id, { paused: true })
    await ctx.reply("Paused. I won't message you unprompted - ask me anything any time. /resume to turn it back on.")
  })

  bot.command('resume', async (ctx) => {
    const user = ensureUser(ctx)
    updateUser(user.id, { paused: false })
    await ctx.reply("Back on. I'll speak up when something's worth it.")
  })

  bot.command('quiet', async (ctx) => {
    const user = ensureUser(ctx)
    const match = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec((ctx.match ?? '').trim())
    if (!match) {
      await ctx.reply('Give me start and end hours, 24h clock. For example: /quiet 22-7')
      return
    }
    const start = Number(match[1])
    const end = Number(match[2])
    if (start > 23 || end > 23) {
      await ctx.reply('Hours must be between 0 and 23.')
      return
    }
    updateUser(user.id, { quietStartHour: start, quietEndHour: end })
    await ctx.reply(`Quiet from ${pad(start)}:00 to ${pad(end)}:00 your local time.`)
  })

  bot.command('limit', async (ctx) => {
    const user = ensureUser(ctx)
    const value = Number.parseInt((ctx.match ?? '').trim(), 10)
    if (!Number.isFinite(value) || value < 0 || value > 10) {
      await ctx.reply('Give me a number from 0 to 10. For example: /limit 2')
      return
    }
    updateUser(user.id, { maxNudgesPerDay: value })
    await ctx.reply(
      value === 0
        ? "Fine - no unprompted messages at all. I'm still here when you ask."
        : `At most ${value} unprompted message${value === 1 ? '' : 's'} a day.`,
    )
  })

  bot.command('journal', async (ctx) => {
    const user = ensureUser(ctx)
    await withTyping(ctx, async () => {
      const text = await mutex.run(user.id, () => generateJournal(user.id))
      for (const chunk of chunkText(text)) await ctx.reply(chunk)
    })
  })

  // --------------------------------------------------------------- photos

  bot.on('message:photo', async (ctx) => {
    const user = ensureUser(ctx)
    const caption = ctx.message.caption?.trim() ?? ''

    await withTyping(ctx, async () => {
      try {
        const file = await ctx.getFile()
        if (!file.file_path) throw new Error('Telegram returned no file path')

        const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
        if (!response.ok) throw new Error(`download failed with HTTP ${response.status}`)

        const bytes = Buffer.from(await response.arrayBuffer())
        fs.mkdirSync(config.photoDir, { recursive: true })
        const filename = `${user.id}-${Date.now()}${path.extname(file.file_path) || '.jpg'}`
        const target = path.join(config.photoDir, filename)
        fs.writeFileSync(target, bytes)

        const stay = currentStay(user.id)
        const context = [
          stay ? `Taken in ${describeStay(stay)}.` : 'Location unknown.',
          caption ? `The traveler wrote: "${caption}"` : '',
        ]
          .filter(Boolean)
          .join(' ')

        const generated = await captionPhoto(bytes, target, context)
        const text = caption || generated || 'Photo'

        addJournalEntry({
          userId: user.id,
          stayId: stay?.id ?? null,
          kind: 'photo',
          text: generated && caption ? `${caption} - ${generated}` : text,
          photoPath: target,
          occurredOn: localDate(stay?.timezone),
        })

        await ctx.reply(generated ? `Saved: ${generated}` : 'Saved to your journal.')
      } catch (error) {
        log.warn(`${user.id}: photo handling failed`, describeError(error))
        await ctx.reply("I couldn't save that photo. Mind sending it again?")
      }
    })
  })

  // ----------------------------------------------------------------- text

  bot.on('message:text', async (ctx) => {
    const user = ensureUser(ctx)
    const text = ctx.message.text.trim()
    if (!text) return

    await withTyping(ctx, async () => {
      try {
        const reply = await mutex.run(user.id, async () => {
          // Snapshot the transcript before the new message joins it, so the
          // extractor can tell what is actually new.
          const priorTranscript = transcriptText(user.id, 8)
          addMessage(user.id, 'user', text)

          // State first, then the reply - so the answer sees the location the
          // traveler just mentioned rather than the previous one.
          await extractAndApply(user.id, text, priorTranscript)

          const answer = await generateReply(user.id)
          addMessage(user.id, 'assistant', answer)
          return answer
        })

        for (const chunk of chunkText(reply)) await ctx.reply(chunk)
      } catch (error) {
        if (error instanceof RefusalError) {
          log.warn(`${user.id}: refusal (${error.category})`)
          await ctx.reply("I can't help with that one. Anything else about the trip?")
          return
        }
        log.error(`${user.id}: reply failed`, describeError(error))
        await ctx.reply("Something went wrong on my end. Try me again in a second?")
      }
    })
  })

  return { bot, send }
}

// ------------------------------------------------------------------ utils

function ensureUser(ctx: Context) {
  const chatId = String(ctx.chat?.id ?? ctx.from?.id)
  const name = ctx.from?.first_name ?? null
  return getOrCreateUserByTelegram(chatId, name)
}

/**
 * Telegram's typing indicator lapses after about five seconds, and an agent
 * turn with tool calls takes longer than that, so it has to be refreshed.
 */
async function withTyping<T>(ctx: Context, task: () => Promise<T>): Promise<T> {
  const ping = () => {
    void ctx.replyWithChatAction('typing').catch(() => undefined)
  }
  ping()
  const handle = setInterval(ping, 4500)
  try {
    return await task()
  } finally {
    clearInterval(handle)
  }
}

function chunkText(text: string): string[] {
  if (text.length <= MAX_MESSAGE) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > MAX_MESSAGE) {
    const window = remaining.slice(0, MAX_MESSAGE)
    const breakAt = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' '))
    const cut = breakAt > MAX_MESSAGE * 0.5 ? breakAt : MAX_MESSAGE
    chunks.push(remaining.slice(0, cut).trim())
    remaining = remaining.slice(cut).trim()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

function pad(hour: number): string {
  return String(hour).padStart(2, '0')
}
