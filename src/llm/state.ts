import { currentStay, listOpenPlans, listPreferences, listStays, type Stay } from '../db/repo.js'
import { daysUntil, localDate, localTimeLabel } from '../util/time.js'

export function describeStay(stay: Stay | undefined): string {
  if (!stay) return 'Unknown'
  const parts = [stay.city, stay.region, stay.country].filter(Boolean)
  return parts.join(', ')
}

/**
 * The traveler's state, rendered for the model. This block is volatile, so it
 * always goes *after* the cache breakpoint on the static instructions.
 */
export function renderTravelerState(userId: string): string {
  const stay = currentStay(userId)
  const timezone = stay?.timezone ?? null
  const lines: string[] = []

  lines.push(`Local date and time where they are: ${localTimeLabel(timezone)}`)
  lines.push(`Local calendar date: ${localDate(timezone)}`)
  lines.push('')

  if (!stay) {
    lines.push('CURRENT LOCATION: unknown. You have not been told where they are yet.')
  } else {
    lines.push(`CURRENT LOCATION: ${describeStay(stay)}`)
    if (stay.lodgingName || stay.lodgingArea) {
      lines.push(
        `Staying at: ${[stay.lodgingName, stay.lodgingArea].filter(Boolean).join(', ')}`,
      )
    }
    if (stay.latitude !== null && stay.longitude !== null) {
      lines.push(`Coordinates: ${stay.latitude.toFixed(4)}, ${stay.longitude.toFixed(4)}`)
    }
    if (stay.arrivalDate) lines.push(`Arrived: ${stay.arrivalDate}`)
    if (stay.departureDate) {
      const left = daysUntil(stay.departureDate, timezone)
      const suffix =
        left === null ? '' : left <= 0 ? ' (today or already past)' : ` (${left} day(s) away)`
      lines.push(`Leaving: ${stay.departureDate}${suffix}`)
    }
  }

  const previous = listStays(userId).filter((s) => !s.isCurrent)
  if (previous.length > 0) {
    lines.push('')
    lines.push(`TRIP SO FAR: ${previous.map(describeStay).join(' -> ')}`)
  }

  const plans = listOpenPlans(userId)
  lines.push('')
  if (plans.length === 0) {
    lines.push('UPCOMING PLANS: none recorded.')
  } else {
    lines.push('UPCOMING PLANS:')
    for (const plan of plans) {
      const when = [plan.onDate, plan.atTime].filter(Boolean).join(' ')
      const detail = plan.detail ? ` - ${plan.detail}` : ''
      lines.push(
        `  [#${plan.id}] ${plan.title}${when ? ` (${when})` : ''} [${plan.status}]${detail}`,
      )
    }
  }

  const prefs = listPreferences(userId)
  lines.push('')
  if (prefs.length === 0) {
    lines.push('KNOWN PREFERENCES: none recorded yet.')
  } else {
    lines.push('KNOWN PREFERENCES:')
    for (const pref of prefs) lines.push(`  ${pref.kind}: ${pref.text}`)
  }

  return lines.join('\n')
}
