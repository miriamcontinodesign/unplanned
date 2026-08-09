import type { Recommendation, Snapshot } from './types'

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

  recommendations: () =>
    request<{ recommendations: Recommendation[]; sampleData?: boolean }>('/api/recommendations'),

  accept: (productCode: string, dayIndex: number) =>
    request<Snapshot>('/api/itinerary/accept', {
      method: 'POST',
      body: JSON.stringify({ productCode, dayIndex }),
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
