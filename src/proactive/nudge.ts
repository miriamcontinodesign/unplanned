import { runAgent } from '../llm/agent.js'
import { NUDGE_SYSTEM } from '../llm/prompts.js'
import { renderTravelerState } from '../llm/state.js'
import { transcriptText } from '../llm/reply.js'
import { effort } from '../config.js'
import {
  currentStay,
  lastNudgeAt,
  nudgeCountToday,
  type User,
} from '../db/repo.js'
import { sendNudgeTool, weatherTool, type NudgeSink } from '../tools/index.js'
import { experienceSearchTool } from '../components/index.js'
import { isQuietHour, localTimeLabel, minutesSince } from '../util/time.js'

/**
 * Cheap deterministic gates, checked before spending a model call. These are
 * the guarantees a traveler can reason about: quiet hours are respected, the
 * daily cap is a cap, and messages are spaced out - none of that is left to
 * the model's judgment.
 */
export function skipReason(user: User): string | null {
  if (user.paused) return 'paused'

  const stay = currentStay(user.id)
  if (!stay) return 'location unknown'
  if (stay.latitude === null || stay.longitude === null) return 'location not geocoded yet'

  if (isQuietHour(stay.timezone, user.quietStartHour, user.quietEndHour)) {
    return `quiet hours (local time ${localTimeLabel(stay.timezone)})`
  }

  const sentToday = nudgeCountToday(user.id, stay.timezone)
  if (sentToday >= user.maxNudgesPerDay) {
    return `daily cap reached (${sentToday}/${user.maxNudgesPerDay})`
  }

  const sinceLast = minutesSince(lastNudgeAt(user.id))
  if (sinceLast < user.minNudgeGapMinutes) {
    return `too soon (${Math.round(sinceLast)}m since last, minimum ${user.minNudgeGapMinutes}m)`
  }

  return null
}

/**
 * Let the model look around and decide. Returning null - because it never
 * called send_nudge - is the expected outcome most of the time.
 */
export async function considerNudge(
  user: User,
): Promise<{ topic: string; message: string } | null> {
  const sink: NudgeSink = { value: null }

  const system: string[] = [
    NUDGE_SYSTEM,
    `# What you know about this traveler\n\n${renderTravelerState(user.id)}`,
  ]

  const prompt = [
    'Decide whether there is anything worth messaging this traveler about right now.',
    '',
    'Recent conversation:',
    transcriptText(user.id, 8) || '(nothing yet)',
    '',
    'Investigate with your tools first, then either call send_nudge once or end your turn without calling anything.',
  ].join('\n')

  await runAgent({
    system,
    messages: [{ role: 'user', content: prompt }],
    tools: [weatherTool(user.id), experienceSearchTool(user.id), sendNudgeTool(sink)],
    effort: effort.nudge,
    maxIterations: 8,
  })

  return sink.value
}
