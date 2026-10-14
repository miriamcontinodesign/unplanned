export type Phase = 'need_destination' | 'ready'

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night'

export interface Trip {
  city: string
  country: string | null
  label: string
  timezone: string | null
  budgetLevel: string | null
  partySize: number | null
}

export interface Preference {
  id: number
  kind: 'like' | 'dislike' | 'constraint'
  text: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  at: string
}

export interface Snapshot {
  user: { id: string; linked: boolean }
  phase: Phase
  greeting: string
  trip: Trip | null
  preferences: Preference[]
  messages: ChatMessage[]
}

export interface PickItem {
  id: number
  title: string
  detail: string | null
  atTime: string | null
  provider: string | null
  productCode: string | null
  priceAmount: number | null
  currency: string | null
  durationMinutes: number | null
}

export interface Recommendation {
  provider: string
  productCode: string
  title: string
  summary: string
  destination: string
  durationMinutes: number
  rating: number | null
  reviewCount: number | null
  fromPrice: { amount: number; currency: string }
  imageUrl: string | null
  tags: string[]
  category?: string | null
  freeCancellation: boolean
  reason: string
}

/** One saved pick, plus whatever the catalogue still knows about it. */
export interface PickDetailData {
  pick: PickItem
  activity: (Omit<Recommendation, 'reason'> & { productUrl: string | null }) | null
}
