import {
  addMessage,
  addPreference,
  currentStay,
  listPreferences,
  setStayGeo,
  upsertCurrentStay,
  type Stay,
} from '../db/repo.js'
import { parseTurn } from './parse.js'
import { logger } from '../util/log.js'

const log = logger('onboarding')

export type Phase = 'need_destination' | 'need_days' | 'ready'

export interface TurnResult {
  reply: string
  phase: Phase
  stay: Stay | undefined
}

export function phaseFor(stay: Stay | undefined): Phase {
  if (!stay) return 'need_destination'
  if (!stay.nights) return 'need_days'
  return 'ready'
}

export function greeting(): string {
  return "Where are you headed? Tell me the place and how long you've got - something like \"Lisbon for 5 days\" is plenty."
}

/**
 * One onboarding turn: parse, write what we learned to trip memory, then decide
 * what still needs asking. Deterministic end to end, so it works without any
 * model credentials.
 */
export async function handleTurn(userId: string, message: string): Promise<TurnResult> {
  const text = message.trim()
  addMessage(userId, 'user', text)

  const parsed = await parseTurn(text)
  const before = currentStay(userId)
  const learned: string[] = []

  // --- destination -----------------------------------------------------------
  if (parsed.destination) {
    const geo = parsed.destination
    const isNewCity = !before || before.city.toLowerCase() !== geo.name.toLowerCase()

    const stay = upsertCurrentStay(userId, {
      city: geo.name,
      country: geo.country,
      countryCode: geo.countryCode,
      region: geo.region,
      latitude: geo.latitude,
      longitude: geo.longitude,
      timezone: geo.timezone,
      ...(parsed.days ? { nights: parsed.days } : {}),
    })

    if (stay.latitude === null) {
      setStayGeo(stay.id, {
        latitude: geo.latitude,
        longitude: geo.longitude,
        timezone: geo.timezone,
        region: geo.region,
        country: geo.country,
        countryCode: geo.countryCode,
      })
    }
    if (isNewCity) learned.push(placeLabel(geo.name, geo.country))
  } else if (parsed.days && before) {
    upsertCurrentStay(userId, { city: before.city, nights: parsed.days })
  }

  // --- everything else -------------------------------------------------------
  if (parsed.partySize || parsed.budgetLevel) {
    const stay = currentStay(userId)
    if (stay) {
      upsertCurrentStay(userId, {
        city: stay.city,
        ...(parsed.partySize ? { partySize: parsed.partySize } : {}),
        ...(parsed.budgetLevel ? { budgetLevel: parsed.budgetLevel } : {}),
      })
    }
  }

  for (const interest of parsed.interests) {
    addPreference(userId, 'like', interest, 'onboarding')
  }

  const stay = currentStay(userId)
  const phase = phaseFor(stay)
  const reply = composeReply({ phase, stay, parsed, learned, said: text })

  addMessage(userId, 'assistant', reply)
  log.debug(`${userId}: phase=${phase} destination=${stay?.city ?? 'none'} nights=${stay?.nights ?? 'none'}`)

  return { reply, phase, stay }
}

function composeReply(input: {
  phase: Phase
  stay: Stay | undefined
  parsed: Awaited<ReturnType<typeof parseTurn>>
  learned: string[]
  said: string
}): string {
  const { phase, stay, parsed } = input

  if (phase === 'need_destination') {
    if (parsed.unresolvedPlace) {
      return `I couldn't find "${parsed.unresolvedPlace}" on the map. Try the city name on its own - "Porto", say, or "Mexico City".`
    }
    if (parsed.days) {
      return `${parsed.days} days, got it. Where are you going?`
    }
    return "I need a destination first. Which city are you headed to?"
  }

  const place = stay ? placeLabel(stay.city, stay.country) : 'there'

  if (phase === 'need_days') {
    return `${place} - good one. How many days have you got there?`
  }

  const nights = stay?.nights ?? 0
  const bits: string[] = [`${place} for ${nights} ${nights === 1 ? 'day' : 'days'}.`]

  const interests = parsed.interests
  if (interests.length > 0) {
    bits.push(`Noted that you're into ${humanList(interests)}.`)
  }

  bits.push("I've pulled together some things worth doing - keep the ones you like and I'll build the itinerary around them.")

  return bits.join(' ')
}

export function placeLabel(city: string, country: string | null | undefined): string {
  return country ? `${city}, ${country}` : city
}

function humanList(items: string[]): string {
  if (items.length === 1) return items[0]!
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

/** Interests the traveler has expressed, for ranking. */
export function interestsFor(userId: string): string[] {
  return listPreferences(userId)
    .filter((p) => p.kind === 'like')
    .map((p) => p.text)
}
