import 'dotenv/config'
import path from 'node:path'

function optionalEnv(name: string): string | null {
  return process.env[name]?.trim() || null
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

function booleanEnv(name: string, fallback = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  throw new Error(`Environment variable ${name} must be true or false, got ${raw}`)
}

export const config = {
  /**
   * Optional: without it the Telegram bot and the proactive engine simply don't
   * start, and the web app runs on its own. That keeps the web half runnable
   * (and testable) with no credentials at all.
   */
  telegramBotToken: optionalEnv('TELEGRAM_BOT_TOKEN'),

  // The Anthropic SDK resolves credentials itself (ANTHROPIC_API_KEY, then
  // ANTHROPIC_AUTH_TOKEN, then an `ant auth login` profile), so we deliberately
  // don't require the key here - a machine set up with `ant auth login` works.
  model: process.env.ROADIO_MODEL?.trim() || 'claude-opus-5',

  dbPath: path.resolve(process.env.ROADIO_DB_PATH?.trim() || './data/roadio.db'),
  photoDir: path.resolve(process.env.ROADIO_PHOTO_DIR?.trim() || './data/photos'),

  viatorMcpUrl:
    process.env.ROADIO_VIATOR_MCP_URL?.trim() ||
    'https://exp-app-mcp.prod.ep.viator.com/mcp',
  viatorMock: booleanEnv('ROADIO_VIATOR_MOCK'),

  tickMinutes: intEnv('ROADIO_TICK_MINUTES', 15),

  httpPort: intEnv('ROADIO_HTTP_PORT', 8787),
  /** Built SPA, served by the same process in production. */
  webDir: path.resolve(process.env.ROADIO_WEB_DIR?.trim() || './web/dist'),
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
