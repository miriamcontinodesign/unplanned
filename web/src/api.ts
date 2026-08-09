import type { Booking, CancelledBooking, Recommendation, Snapshot } from './types'

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

  reset: () => request<Snapshot>('/api/reset', { method: 'POST' }),

  recommendations: () =>
    request<{ recommendations: Recommendation[]; sampleData?: boolean }>('/api/recommendations'),

  accept: (productCode: string, dayIndex: number) =>
    request<Snapshot>('/api/itinerary/accept', {
      method: 'POST',
      body: JSON.stringify({ productCode, dayIndex }),
    }),

  book: (productCode: string) =>
    request<Snapshot & { booking: Booking; checkoutRequired?: boolean }>('/api/bookings/confirm', {
      method: 'POST',
      body: JSON.stringify({ productCode }),
    }),

  callToBook: (productCode: string, dayIndex: number) =>
    request<{ taskId: string; status: string }>('/api/bookings/call', {
      method: 'POST',
      body: JSON.stringify({ productCode, dayIndex }),
    }),

  callStatus: (taskId: string) =>
    request<{
      status: string
      confirmed: boolean | null
      note: string | null
    }>(`/api/bookings/call/${encodeURIComponent(taskId)}`),

  confirmedBookings: () =>
    request<{ bookings: Booking[] }>('/api/bookings/confirmed'),

  cancelBooking: (id: string) =>
    request<Snapshot & { booking: CancelledBooking }>(`/api/bookings/${id}/cancel`, {
      method: 'POST',
    }),

  pass: (productCode: string) =>
    request<Snapshot>('/api/itinerary/pass', {
      method: 'POST',
      body: JSON.stringify({ productCode }),
    }),

  remove: (id: number) =>
    request<Snapshot>(`/api/itinerary/${id}/remove`, { method: 'POST' }),

  linkCode: () => request<{ code: string; expiresAt: string }>('/api/link/code', { method: 'POST' }),
}
