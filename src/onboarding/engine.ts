import { setStayGeo, upsertCurrentStay, type Stay } from '../db/repo.js'
import type { GeoResult } from '../services/geocode.js'

export type Phase = 'need_destination' | 'ready'

export function phaseFor(stay: Stay | undefined): Phase {
  return stay ? 'ready' : 'need_destination'
}

export function greeting(): string {
  return "What are you up to? Tell me what you're in the mood for and where you are, and I'll take it from there."
}

/**
 * Write a resolved place to trip memory. Shared by the LLM extraction pass
 * (which resolves a place mentioned in chat) and by the silent location
 * endpoint - detecting a location shouldn't itself count as a conversational
 * turn, it just resolves the same field a chat message would have.
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

export function placeLabel(city: string, country: string | null | undefined): string {
  return country ? `${city}, ${country}` : city
}
