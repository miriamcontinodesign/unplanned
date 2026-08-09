import { anthropic } from './client.js'
import { config } from '../config.js'
import { collectText } from './agent.js'
import { describeStay } from './state.js'
import { listAllPlans, listJournal, listStays } from '../db/repo.js'

const JOURNAL_SYSTEM = `You write a short travel journal from a structured record of someone's trip.

Write it as a few tight paragraphs in past tense, in the traveler's own register - warm, plain, no travel-brochure adjectives. Group by place, in the order they visited. Mention what they actually did and what they said about it; skip anything the record doesn't support.

Do not invent details. If the record is thin for a leg of the trip, say less about it rather than padding. No headers, no bullet points, no closing summary paragraph telling them what a wonderful journey it was.`

/** Narrative trip summary built from stays, completed plans and journal entries. */
export async function generateJournal(userId: string): Promise<string> {
  const stays = listStays(userId)
  const entries = listJournal(userId)
  const done = listAllPlans(userId).filter((plan) => plan.status === 'done')

  if (stays.length === 0 && entries.length === 0) {
    return "Nothing in the journal yet. Tell me where you are and what you get up to, and I'll keep track."
  }

  const record = [
    'PLACES:',
    ...stays.map((stay) => {
      const dates = [stay.arrivalDate, stay.departureDate].filter(Boolean).join(' to ')
      const lodging = [stay.lodgingName, stay.lodgingArea].filter(Boolean).join(', ')
      return `- ${describeStay(stay)}${dates ? ` (${dates})` : ''}${lodging ? ` - stayed ${lodging}` : ''}`
    }),
    '',
    'THINGS THEY DID:',
    ...(done.length > 0
      ? done.map((plan) => `- ${plan.title}${plan.detail ? ` - ${plan.detail}` : ''}`)
      : ['- (none recorded)']),
    '',
    'NOTES AND PHOTOS:',
    ...(entries.length > 0
      ? entries.map(
          (entry) =>
            `- ${entry.occurredOn ?? entry.createdAt.slice(0, 10)} [${entry.kind}] ${entry.text}`,
        )
      : ['- (none recorded)']),
  ].join('\n')

  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: 8000,
    system: JOURNAL_SYSTEM,
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: `Trip record:\n\n${record}` }],
  })

  if (response.stop_reason === 'refusal') {
    return "I couldn't put the journal together just now. Try again in a moment."
  }
  return collectText(response) || 'The record is too thin to write anything from yet.'
}
