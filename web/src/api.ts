import type { DetectedPlace } from './geolocate'
import type { PickItem, Recommendation, Snapshot, TimeOfDay } from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    // The session cookie is the identity, so it must ride every request.
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Request failed (${response.status})`)
  }
  return (await response.json()) as T
}

export const api = {
  me: () => request<Snapshot>('/api/me'),

  chat: (message: string) =>
    request<Snapshot & { reply: string }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  setLocation: (place: DetectedPlace) =>
    request<Snapshot>('/api/location', {
      method: 'POST',
      body: JSON.stringify({
        city: place.city,
        country: place.country,
        countryCode: place.countryCode,
        region: place.region,
        latitude: place.latitude,
        longitude: place.longitude,
      }),
    }),

  recommendations: (slot?: TimeOfDay) =>
    request<{ recommendations: Recommendation[]; slot: TimeOfDay; sampleData?: boolean }>(
      `/api/recommendations${slot ? `?slot=${slot}` : ''}`,
    ),

  accept: (productCode: string, timeOfDay: TimeOfDay) =>
    request<{ ok: true }>('/api/activities/accept', {
      method: 'POST',
      body: JSON.stringify({ productCode, timeOfDay }),
    }),

  pass: (productCode: string) =>
    request<{ ok: true }>('/api/activities/pass', {
      method: 'POST',
      body: JSON.stringify({ productCode }),
    }),

  callToBook: (productCode: string, timeOfDay: TimeOfDay) =>
    request<{ taskId: string; status: string; dashboardUrl: string }>('/api/bookings/call', {
      method: 'POST',
      body: JSON.stringify({ productCode, timeOfDay }),
    }),

  linkCode: () => request<{ code: string; expiresAt: string }>('/api/link/code', { method: 'POST' }),

  reset: () => request<{ ok: true }>('/api/reset', { method: 'POST' }),

  picks: () => request<{ picks: PickItem[] }>('/api/activities'),

  removePick: (id: number) => request<{ ok: true }>(`/api/activities/${id}/remove`, { method: 'POST' }),
}
