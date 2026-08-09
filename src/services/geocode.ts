import { logger, describeError } from '../util/log.js'

const log = logger('geocode')

export interface GeoResult {
  name: string
  latitude: number
  longitude: number
  timezone: string
  region: string | null
  country: string | null
  /** ISO 3166-1 alpha-2, which is what the web search tool's user_location wants. */
  countryCode: string | null
}

interface OpenMeteoGeoResponse {
  results?: Array<{
    name: string
    latitude: number
    longitude: number
    timezone?: string
    admin1?: string
    country?: string
    country_code?: string
  }>
}

/**
 * Resolve a place name to coordinates and an IANA timezone.
 * Open-Meteo's geocoding API is free and needs no key.
 */
export async function geocode(place: string): Promise<GeoResult | null> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search')
  url.searchParams.set('name', place)
  url.searchParams.set('count', '1')
  url.searchParams.set('language', 'en')
  url.searchParams.set('format', 'json')

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) {
      log.warn(`geocoding "${place}" failed with HTTP ${response.status}`)
      return null
    }
    const body = (await response.json()) as OpenMeteoGeoResponse
    const hit = body.results?.[0]
    if (!hit) {
      log.info(`no geocoding match for "${place}"`)
      return null
    }
    const code = hit.country_code?.trim().toUpperCase()
    return {
      name: hit.name,
      latitude: hit.latitude,
      longitude: hit.longitude,
      timezone: hit.timezone ?? 'UTC',
      region: hit.admin1 ?? null,
      country: hit.country ?? null,
      countryCode: code && code.length === 2 ? code : null,
    }
  } catch (error) {
    log.warn(`geocoding "${place}" threw`, describeError(error))
    return null
  }
}
