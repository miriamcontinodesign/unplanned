import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'
import { llm, withModelFallback } from './client.js'
import { effort, reasoningParams } from '../config.js'
import { transcriptText } from './reply.js'
import { renderTravelerState } from './state.js'
import { describeError, logger } from '../util/log.js'

const log = logger('suggest')

const Suggestions = z.object({ suggestions: z.array(z.string()) })

const SUGGESTER_SYSTEM = `You write the quick-reply buttons shown under a same-day activity concierge chat.

Given the conversation so far, write exactly three short replies the traveler might tap next, things the traveler could say or ask the concierge next (requests or questions, not announcements of plans; no quotes). Each is at most six words.

They must follow naturally from the latest reply: narrow it down, change the vibe, adjust budget or timing, or ask about something specific that was just mentioned. Make the three clearly different from each other. Never repeat something the traveler already said, and never suggest a city.`

/** Three follow-up chips for the latest turn, or none if the model call fails. */
export async function suggestFollowUps(userId: string): Promise<string[]> {
  try {
    const response = await withModelFallback((model) =>
      llm().chat.completions.parse({
        model,
        max_tokens: 2000,
        response_format: zodResponseFormat(Suggestions, 'suggestions'),
        ...reasoningParams(effort.suggest),
        messages: [
          { role: 'system', content: SUGGESTER_SYSTEM },
          {
            role: 'user',
            content: `Trip record:\n${renderTravelerState(userId)}\n\nConversation:\n${transcriptText(userId, 6)}`,
          },
        ],
      }),
    )
    const parsed = response.choices[0]?.message.parsed
    return (parsed?.suggestions ?? [])
      .map((text) => text.trim())
      .filter((text) => text.length > 0 && text.length <= 60)
      .slice(0, 3)
  } catch (error) {
    log.warn('suggestions failed', describeError(error))
    return []
  }
}
