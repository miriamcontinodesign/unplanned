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
   * Required for anything that calls the model. Left optional here so the
   * smoke test still runs without it - the failure should come from the call,
   * not from startup.
   */
  openRouterApiKey: optionalEnv('OPENROUTER_API_KEY'),

  /**
   * An OpenRouter model slug, not an Anthropic alias. Anything on their catalogue
   * that supports `tools` and `structured_outputs` will work; the concierge needs
   * both, and captioning additionally needs image input.
   */
  model: process.env.ROADIO_MODEL?.trim() || 'google/gemini-2.5-flash-lite',

  /**
   * OpenRouter's unified reasoning switch. On by default because the per-call
   * effort levels below are a real part of the design, but worth turning off on
   * the cheapest models, where reasoning tokens can cost more than they buy.
   */
  reasoning: booleanEnv('ROADIO_REASONING', true),

  dbPath: path.resolve(process.env.ROADIO_DB_PATH?.trim() || './data/roadio.db'),

  viatorMcpUrl:
    process.env.ROADIO_VIATOR_MCP_URL?.trim() ||
    'https://exp-app-mcp.prod.ep.viator.com/mcp',
  viatorMock: booleanEnv('ROADIO_VIATOR_MOCK'),

  httpPort: intEnv('ROADIO_HTTP_PORT', 8787),
  /** Built SPA, served by the same process in production. */
  webDir: path.resolve(process.env.ROADIO_WEB_DIR?.trim() || './web/dist'),
} as const

/**
 * Effort per call site. The reply path is interactive, so it trades some depth
 * for latency; the extraction path is a narrow structured task that does not
 * need depth; the nudge path is unattended and gets the most room to think,
 * because deciding *not* to interrupt someone is the judgment call that matters.
 *
 * These map onto OpenRouter's unified `reasoning.effort`, which it translates
 * per provider. Models that ignore reasoning entirely will simply disregard it,
 * so a model swap never turns these into an error.
 */
export type EffortLevel = 'low' | 'medium' | 'high'

export const effort = {
  reply: 'medium',
  extract: 'low',
  nudge: 'high',
  caption: 'low',
} as const satisfies Record<string, EffortLevel>

/** Spread into a request. Empty when reasoning is switched off. */
export function reasoningParams(level: EffortLevel): {
  reasoning?: { effort: EffortLevel }
} {
  return config.reasoning ? { reasoning: { effort: level } } : {}
}
