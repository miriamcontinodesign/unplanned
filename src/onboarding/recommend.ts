import { activityProvider, type Activity } from '../providers/index.js'
import { currentStay, decidedProductCodes, listBookings, listPreferences } from '../db/repo.js'

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night'

export interface Recommendation extends Activity {
  /** Why this was surfaced, grounded in what we actually know about the traveler. */
  reason: string
}

/**
 * The experiences the concierge itself searched for on the traveler's latest request,
 * so the cards show what the reply is talking about instead of a second, profile-only
 * search. In memory on purpose: it is a view of the current conversation, not trip state.
 */
const chatResults = new Map<string, { destination: string; activities: Activity[]; stale: boolean }>()

/** Call when a new message arrives: the next search replaces the old results instead of adding to them. */
export function startChatTurn(userId: string): void {
  const entry = chatResults.get(userId)
  if (entry) entry.stale = true
}

/** A turn can search more than once; every search in it contributes cards. */
export function rememberChatResults(userId: string, destination: string, activities: Activity[]): void {
  if (activities.length === 0) return
  const entry = chatResults.get(userId)
  if (!entry || entry.stale || entry.destination !== destination) {
    chatResults.set(userId, { destination, activities, stale: false })
    return
  }
  const known = new Set(entry.activities.map((activity) => activity.productCode))
  entry.activities.push(...activities.filter((activity) => !known.has(activity.productCode)))
}

/**
 * Once the reply is written, keep only the experiences it actually recommends (matched by
 * booking link or title). A turn that searched but recommended nothing relevant, or did not
 * search at all, leaves no cards rather than off-topic ones.
 */
export function finishChatTurn(userId: string, destination: string, reply: string): void {
  const entry = chatResults.get(userId)
  const searchedThisTurn = entry !== undefined && !entry.stale && entry.destination === destination
  const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')
  const text = squash(reply)
  const mentioned = (activity: Activity) =>
    reply.includes(activity.productCode) || text.includes(squash(activity.title).slice(0, 30))

  chatResults.set(userId, {
    destination,
    activities: searchedThisTurn ? entry.activities.filter(mentioned) : [],
    stale: true,
  })
}

/** Hour (0-23, local to the traveler) to the slot the picker shows by default. */
export function slotForHour(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

// What the catalogue's tags say about when an activity actually fits. Kept
// separate from like/dislike scoring because a genuine interest match should
// always outrank a slot fit - the traveler said what they want, the clock is
// just a tiebreaker.
const SLOT_FIT: Record<TimeOfDay, string[]> = {
  morning: ['food', 'wellness', 'active', 'outdoors', 'history', 'walking'],
  afternoon: ['food', 'outdoors', 'active', 'art', 'history', 'culture', 'scenic', 'water', 'day-trip'],
  evening: ['food', 'scenic', 'culture', 'social', 'private', 'relaxed'],
  night: ['nightlife', 'social', 'scenic'],
}

const SLOT_MISMATCH: Record<TimeOfDay, string[]> = {
  morning: ['nightlife'],
  afternoon: ['nightlife'],
  evening: [],
  night: ['outdoors', 'active', 'wellness', 'day-trip'],
}

/**
 * Rank the catalogue against trip memory and the time of day.
 *
 * Deliberately deterministic: interest overlap, budget fit, rating and slot
 * fit. A model pass can rewrite the reasons in a warmer voice later, but the
 * ordering should stay explainable - a recommendation the traveler cannot see
 * the logic of is indistinguishable from a random one.
 */
export async function recommendationsFor(
  userId: string,
  timeOfDay: TimeOfDay,
  limit = 8,
): Promise<Recommendation[]> {
  const stay = currentStay(userId)
  if (!stay) return []

  // Results from the latest chat search win while they are for the city the traveler
  // is in now. They keep Viator's relevance order, so the time-of-day tabs do not
  // reshuffle them.
  const fromChat = chatResults.get(userId)
  if (fromChat && fromChat.destination.toLowerCase() === stay.city.toLowerCase()) {
    const decided = decidedProductCodes(userId)
    return fromChat.activities
      .filter((activity) => !decided.has(activity.productCode))
      .slice(0, limit)
      .map((activity) => ({
        ...activity,
        reason: buildReason(activity, [], [], timeOfDay, stay.budgetLevel).replace(
          /^/,
          'Picked for what you asked · ',
        ),
      }))
  }

  const likes = listPreferences(userId)
    .filter((p) => p.kind === 'like')
    .map((p) => p.text.toLowerCase())
  const dislikes = listPreferences(userId)
    .filter((p) => p.kind === 'dislike')
    .map((p) => p.text.toLowerCase())

  // Viator requires a participation window. Use the trip dates when they are
  // still actionable; otherwise open a short window beginning tomorrow so a
  // location-only trip can still produce cards.
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

  const slotFit = SLOT_FIT[timeOfDay]
  const slotMismatch = SLOT_MISMATCH[timeOfDay]

  const scored = fresh.map((activity) => {
    const matched = activity.tags.filter((tag) =>
      likes.some((like) => tag.includes(like) || like.includes(tag)),
    )
    const clashes = activity.tags.filter((tag) =>
      dislikes.some((dislike) => dislike.includes(tag) || tag.includes(dislike)),
    )
    const fits = activity.tags.filter((tag) => slotFit.includes(tag))
    const mismatches = activity.tags.filter((tag) => slotMismatch.includes(tag))

    const score =
      matched.length * 10 - clashes.length * 8 + (activity.rating ?? 0) + fits.length * 5 - mismatches.length * 12
    return { activity, score, matched, fits }
  })

  scored.sort((a, b) => b.score - a.score)

  return scored
    .slice(0, limit)
    .map((entry) => ({
      ...entry.activity,
      reason: buildReason(entry.activity, entry.matched, entry.fits, timeOfDay, stay.budgetLevel),
    }))
}

function buildReason(
  activity: Activity,
  matched: string[],
  slotMatched: string[],
  timeOfDay: TimeOfDay,
  budgetLevel: string | null,
): string {
  const parts: string[] = []

  if (matched.length > 0) {
    parts.push(`matches your interest in ${matched.slice(0, 2).join(' and ')}`)
  }
  if (slotMatched.length > 0) {
    parts.push(`a good fit for ${timeOfDay}`)
  }
  if ((activity.rating ?? 0) >= 4.7) {
    parts.push(`${activity.rating!.toFixed(1)} from ${activity.reviewCount?.toLocaleString() ?? 'past'} travellers`)
  }
  if (budgetLevel === 'shoestring' && activity.fromPrice.amount <= 60) {
    parts.push('and cheap')
  }
  if (activity.freeCancellation) {
    parts.push('free cancellation')
  }

  if (parts.length === 0) return 'A solid, well-reviewed option in the city.'
  const sentence = parts.join(' · ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.'
}
