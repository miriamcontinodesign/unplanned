import 'dotenv/config'
import path from 'node:path'

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    )
  }
  return value
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got ${raw}`)
  }
  return parsed
}

export const config = {
  telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),

  // The Anthropic SDK resolves credentials itself (ANTHROPIC_API_KEY, then
  // ANTHROPIC_AUTH_TOKEN, then an `ant auth login` profile), so we deliberately
  // don't require the key here - a machine set up with `ant auth login` works.
  model: process.env.ROADIO_MODEL?.trim() || 'claude-opus-5',

  dbPath: path.resolve(process.env.ROADIO_DB_PATH?.trim() || './data/roadio.db'),
  photoDir: path.resolve(process.env.ROADIO_PHOTO_DIR?.trim() || './data/photos'),

  tickMinutes: intEnv('ROADIO_TICK_MINUTES', 15),
} as const

/**
 * Effort per call site. The reply path is interactive, so it trades some depth
 * for latency; the extraction path is a narrow structured task that does not
 * need depth; the nudge path is unattended and gets the most room to think,
 * because deciding *not* to interrupt someone is the judgment call that matters.
 */
export const effort = {
  reply: 'medium',
  extract: 'low',
  nudge: 'high',
  caption: 'low',
} as const
