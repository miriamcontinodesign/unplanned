import { activityProvider, type Activity } from '../providers/index.js'
import {
  currentStay,
  decidedProductCodes,
  listBookings,
  listOpenPlans,
  listPreferences,
} from '../db/repo.js'
import { seededUnit } from '../util/ids.js'

export interface Recommendation extends Activity {
  /** Why this was surfaced, grounded in what we actually know about the traveler. */
  reason: string
  suggestedDay: number
}

const DEMO_STREETS = ['Market Lane', 'Garden Street', 'River Walk', 'Old Town Road', 'Central Avenue', 'Gallery Lane', 'Station Street', 'Harbour Road', 'Sunset Walk', 'Museum Lane']

function demoMeetingPoint(stay: NonNullable<ReturnType<typeof currentStay>>, productCode: string, index: number) {
  const angle = seededUnit(productCode, 'map-angle') * Math.PI * 2
  const distance = 0.003 + seededUnit(productCode, 'map-distance') * 0.012
  const latitude = (stay.latitude ?? 0) + Math.sin(angle) * distance
  const longitude = (stay.longitude ?? 0) + Math.cos(angle) * distance
  const streetNumber = 10 + Math.floor(seededUnit(productCode, 'street-number') * 190)
  const street = DEMO_STREETS[Math.floor(seededUnit(productCode, 'street') * DEMO_STREETS.length)]!
  return {
    name: `Demo meeting point ${index + 1}`,
    address: `Demo · ${streetNumber} ${street}, ${stay.city}`,
    latitude,
    longitude,
    isDemo: true,
  }
}

/**
 * Rank the catalogue against trip memory.
 *
 * Deliberately deterministic: interest overlap, budget fit and rating. A model
 * pass can rewrite the reasons in a warmer voice later, but the ordering should
 * stay explainable - a recommendation the traveler cannot see the logic of is
 * indistinguishable from a random one.
 */
export async function recommendationsFor(userId: string, limit = 10): Promise<Recommendation[]> {
  const stay = currentStay(userId)
  if (!stay) return []

  const likes = listPreferences(userId)
    .filter((p) => p.kind === 'like')
    .map((p) => p.text.toLowerCase())
  const dislikes = listPreferences(userId)
    .filter((p) => p.kind === 'dislike')
    .map((p) => p.text.toLowerCase())

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const fromDate = stay.arrivalDate && stay.arrivalDate >= tomorrow ? stay.arrivalDate : tomorrow
  const toDate = stay.departureDate && stay.departureDate >= fromDate
    ? stay.departureDate
    : new Date(Date.parse(`${fromDate}T12:00:00Z`) + Math.max(stay.nights ?? 3, 1) * 86_400_000)
      .toISOString().slice(0, 10)

  const activities = await activityProvider().search({
    userId,
    destination: stay.city,
    countryCode: stay.countryCode,
    interests: likes,
    budgetLevel: stay.budgetLevel,
    partySize: stay.partySize ?? 2,
    fromDate,
    toDate,
    limit: 24,
  })

  // Anything already accepted or passed on must not come back.
  const decided = decidedProductCodes(userId)
  for (const booking of listBookings(userId)) {
    if (booking.status === 'confirmed') decided.add(booking.productCode)
  }
  const fresh = activities.filter((activity) => !decided.has(activity.productCode))

  const days = Math.max(stay.nights ?? 3, 1)
  const alreadyPlanned = listOpenPlans(userId).length

  const scored = fresh.map((activity) => {
    const matched = activity.tags.filter((tag) =>
      likes.some((like) => tag.includes(like) || like.includes(tag)),
    )
    const clashes = activity.tags.filter((tag) =>
      dislikes.some((dislike) => dislike.includes(tag) || tag.includes(dislike)),
    )

    const score = matched.length * 10 - clashes.length * 8 + (activity.rating ?? 0)
    return { activity, score, matched }
  })

  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, limit).map((entry, index) => ({
    ...entry.activity,
    meetingPoint: demoMeetingPoint(stay, entry.activity.productCode, index),
    reason: buildReason(entry.activity, entry.matched, stay.budgetLevel),
    // Spread suggestions across the trip rather than stacking them on day one.
    suggestedDay: ((alreadyPlanned + index) % days) + 1,
  }))
}

function buildReason(
  activity: Activity,
  matched: string[],
  budgetLevel: string | null,
): string {
  const parts: string[] = []

  if (matched.length > 0) {
    parts.push(`matches your interest in ${matched.slice(0, 2).join(' and ')}`)
  }
  if ((activity.rating ?? 0) >= 4.7) {
    parts.push(`rated ${activity.rating} by ${activity.reviewCount?.toLocaleString() ?? 'past'} travellers`)
  }
  if (budgetLevel === 'shoestring' && activity.fromPrice.amount <= 60) {
    parts.push('and cheap')
  }
  if (activity.freeCancellation) {
    parts.push('free to cancel')
  }

  if (parts.length === 0) return 'A solid, well-reviewed option in the city.'
  const sentence = parts.join(', ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.'
}
