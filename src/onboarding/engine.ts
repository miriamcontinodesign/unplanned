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
import type { GeoResult } from '../services/geocode.js'
import { logger } from '../util/log.js'

const log = logger('onboarding')

export type Phase = 'need_destination' | 'ready'

export interface TurnResult {
  reply: string
  phase: Phase
  stay: Stay | undefined
}

export function phaseFor(stay: Stay | undefined): Phase {
  return stay ? 'ready' : 'need_destination'
}

export function greeting(): string {
  return "What are you up to? Tell me what you're in the mood for and where you are, and I'll take it from there."
}

/**
 * Write a resolved place to trip memory. Shared by the chat turn below and by
 * the silent location endpoint - detecting a location shouldn't itself count
 * as a conversational turn, it just resolves the same field a chat message
 * would have.
 */
export function applyDestination(userId: string, geo: GeoResult): Stay {
  const stay = upsertCurrentStay(userId, {
    city: geo.name,
    country: geo.country,
    countryCode: geo.countryCode,
    region: geo.region,
    latitude: geo.latitude,
    longitude: geo.longitude,
    timezone: geo.timezone,
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

  return stay
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

    const stay = applyDestination(userId, geo)
    if (parsed.days) upsertCurrentStay(userId, { city: stay.city, nights: parsed.days })
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
    if (parsed.interests.length > 0) {
      return `Noted that you're into ${humanList(parsed.interests)}. Which city are you in, so I can find things nearby?`
    }
    return 'Which city are you in?'
  }

  const place = stay ? placeLabel(stay.city, stay.country) : 'there'
  const bits: string[] = [`${place} - got it.`]

  const interests = parsed.interests
  if (interests.length > 0) {
    bits.push(`Noted that you're into ${humanList(interests)}.`)
  }

  bits.push('Pick a time of day and I’ll pull together things worth doing right now.')

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
