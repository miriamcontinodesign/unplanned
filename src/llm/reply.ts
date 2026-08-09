import type Anthropic from '@anthropic-ai/sdk'
import { runAgent } from './agent.js'
import { CONCIERGE_SYSTEM } from './prompts.js'
import { renderTravelerState } from './state.js'
import { effort } from '../config.js'
import { currentStay, recentMessages } from '../db/repo.js'
import { weatherTool, webSearchTool } from '../tools/index.js'

/**
 * Build the system blocks with the cache breakpoint on the static instructions.
 * Everything volatile (state, local time) goes after it, so the stable prefix
 * stays cacheable across turns and across travelers.
 */
export function conciergeSystem(userId: string): Anthropic.TextBlockParam[] {
  return [
    { type: 'text', text: CONCIERGE_SYSTEM, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `# What you know about this traveler\n\n${renderTravelerState(userId)}` },
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
export function conversationMessages(userId: string, limit = 16): Anthropic.MessageParam[] {
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
  const stay = currentStay(userId)

  const result = await runAgent({
    system: conciergeSystem(userId),
    messages: conversationMessages(userId),
    tools: [weatherTool(userId), webSearchTool(stay)],
    effort: effort.reply,
    maxIterations: 6,
  })

  return (
    result.text ||
    "I got a bit lost there - could you say that again?"
  )
}
