import type OpenAI from 'openai'
import { runAgent } from './agent.js'
import { CONCIERGE_SYSTEM } from './prompts.js'
import { renderTravelerState } from './state.js'
import { effort } from '../config.js'
import { recentMessages } from '../db/repo.js'
import { experienceSearchTool } from '../components/index.js'
import { weatherTool } from '../tools/index.js'

/**
 * Static instructions first, volatile traveler state second. OpenRouter has no
 * explicit cache breakpoint the way Anthropic did, but several of its providers
 * cache prefixes automatically, so keeping the stable text first still pays.
 */
export function conciergeSystem(userId: string): string[] {
  return [
    CONCIERGE_SYSTEM,
    `# What you know about this traveler\n\n${renderTravelerState(userId)}`,
  ]
}

/**
 * Recent turns as a transcript for the model.
 *
 * The window is trimmed to start on a user turn: the API rejects a `messages`
 * array whose first entry is an assistant message, and truncating a long
 * conversation can easily slice into the middle of one - especially once
 * proactive nudges have added unpaired assistant turns.
 */
export function conversationMessages(
  userId: string,
  limit = 16,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const window = recentMessages(userId, limit)
  const firstUserTurn = window.findIndex((message) => message.role === 'user')
  if (firstUserTurn === -1) return []

  return window.slice(firstUserTurn).map((message) => ({
    role: message.role,
    content: message.proactive ? `(sent proactively) ${message.text}` : message.text,
  }))
}

export function transcriptText(userId: string, limit = 8): string {
  return recentMessages(userId, limit)
    .map((message) => `${message.role === 'user' ? 'Traveler' : 'Roadio'}: ${message.text}`)
    .join('\n')
}

/**
 * Pass two of two: answer the traveler. Read-only - state writes happen in the
 * extraction pass so that a good reply and a correct record don't depend on
 * each other.
 */
export async function generateReply(userId: string): Promise<string> {
  const result = await runAgent({
    system: conciergeSystem(userId),
    messages: conversationMessages(userId),
    tools: [weatherTool(userId), experienceSearchTool(userId)],
    effort: effort.reply,
    maxIterations: 6,
  })

  return (
    result.text ||
    "I got a bit lost there - could you say that again?"
  )
}
