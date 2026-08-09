export type Phase = 'need_destination' | 'need_days' | 'ready'

export interface Trip {
  city: string
  country: string | null
  label: string
  days: number | null
  timezone: string | null
  budgetLevel: string | null
  partySize: number | null
}

export interface ItineraryItem {
  id: number
  title: string
  detail: string | null
  durationMinutes: number | null
  priceAmount: number | null
  currency: string | null
  productCode: string | null
}

export interface ItineraryDay {
  day: number
  items: ItineraryItem[]
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
  itinerary: ItineraryDay[]
  preferences: Preference[]
  messages: ChatMessage[]
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
  suggestedDay: number
  meetingPoint?: {
    name: string
    address: string
    latitude: number
    longitude: number
    isDemo?: boolean
  } | null
}

export interface Booking {
  id: string
  provider: string
  productCode: string
  productTitle: string
  optionTitle: string | null
  travelDate: string
  startTime: string | null
  partySize: number
  currency: string
  totalAmount: number
  status: 'confirmed'
  bookingRef: string | null
  cancellationPolicy: string | null
  createdAt: string
}

export interface CancelledBooking extends Omit<Booking, 'status'> {
  status: 'cancelled'
}
