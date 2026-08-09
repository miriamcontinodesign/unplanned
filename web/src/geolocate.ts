/**
 * Browser geolocation -> resolved place, so onboarding never has to make
 * someone type the one thing their phone already knows. Reverse geocoding
 * runs against BigDataCloud's free, keyless client endpoint - Open-Meteo
 * (used everywhere else in this app) only geocodes forward, name to
 * coordinates, not the other way around.
 *
 * Deliberately returns the browser's own coordinates alongside the resolved
 * name/country/region, rather than just a bare city string. A second,
 * name-based geocode on the backend could land on an unrelated place that
 * happens to share that name - the coordinates are what's actually known for
 * certain, so they're what should carry through, not get re-guessed from text.
 */

export interface DetectedPlace {
  city: string
  country: string | null
  countryCode: string | null
  region: string | null
  latitude: number
  longitude: number
  /** "City, Country" - for display only. */
  label: string
}

interface ReverseGeoResponse {
  city?: string
  locality?: string
  countryName?: string
  countryCode?: string
  principalSubdivision?: string
}

export function detectLocation(): Promise<DetectedPlace> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error("This browser won't share your location - where are you?"))
      return
    }

    // The Geolocation API is only available in a secure context (https, or
    // localhost). Testing over a LAN IP like http://192.168.x.x:5173 from a
    // phone hits exactly this - getCurrentPosition then fails in a way that
    // looks like a permission denial, which is a misleading thing to show.
    if (!window.isSecureContext) {
      reject(new Error('Location needs a secure connection (https, or localhost) - where are you?'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        void reverseGeocode(position.coords.latitude, position.coords.longitude).then(resolve, reject)
      },
      (geoError) => {
        reject(
          new Error(
            geoError.code === geoError.PERMISSION_DENIED
              ? "I don't have permission to check your location - where are you?"
              : 'I could not get a location fix - where are you?',
          ),
        )
      },
      // High accuracy asks for GPS where it's available (mobile) instead of
      // coarser WiFi/IP-based positioning, which can be wrong by hundreds or
      // thousands of kilometres, especially over a VPN or on desktop.
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5 * 60_000 },
    )
  })
}

async function reverseGeocode(latitude: number, longitude: number): Promise<DetectedPlace> {
  const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client')
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('longitude', String(longitude))
  url.searchParams.set('localityLanguage', 'en')

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error('I found your location but could not match it to a city - where are you?')

  const body = (await response.json()) as ReverseGeoResponse
  const city = body.city || body.locality
  if (!city) throw new Error('I found your location but could not figure out the city - where are you?')

  const countryCode = body.countryCode?.trim().toUpperCase() || null
  return {
    city,
    country: body.countryName ?? null,
    countryCode: countryCode && countryCode.length === 2 ? countryCode : null,
    region: body.principalSubdivision ?? null,
    // The browser's own fix, not anything BigDataCloud may have snapped to -
    // this is the coordinate the rest of the app should trust.
    latitude,
    longitude,
    label: body.countryName ? `${city}, ${body.countryName}` : city,
  }
}
