export type BudgetLevel = 'shoestring' | 'moderate' | 'comfortable' | 'luxury'

export interface Money {
  amount: number
  currency: string
}

export interface Activity {
  provider: string
  productCode: string
  title: string
  summary: string
  destination: string
  durationMinutes: number
  rating: number | null
  reviewCount: number | null
  fromPrice: Money
  /** Null when the provider has no imagery; the UI renders generated art instead. */
  imageUrl: string | null
  tags: string[]
  freeCancellation: boolean
  /** The operator's own page. Used for deeplink booking and "read more". */
  productUrl: string | null
  /** Verified supplier meeting point. Omitted when Viator has not supplied one. */
  meetingPoint?: {
    name: string
    address: string
    latitude: number
    longitude: number
    isDemo?: boolean
  } | null
}

export interface ActivitySearchQuery {
  /** Stable Roadio traveler id used to maintain the Viator MCP search session. */
  userId?: string
  destination: string
  countryCode?: string | null
  interests?: string[]
  budgetLevel?: BudgetLevel | null
  partySize?: number
  fromDate?: string | null
  toDate?: string | null
  limit?: number
}

export interface AvailabilityOption {
  optionCode: string
  title: string
  startTime: string | null
  total: Money
  available: boolean
  cancellationPolicy: string
}

export interface HoldRequest {
  productCode: string
  optionCode: string
  travelDate: string
  partySize: number
}

export interface HoldResult {
  holdRef: string
  expiresAt: string
  total: Money
  cancellationPolicy: string
}

export interface BookRequest {
  holdRef: string
  productCode: string
  optionCode: string
  travelDate: string
  partySize: number
  traveler: { firstName: string; lastName: string; email: string }
}

export interface BookResult {
  bookingRef: string
  status: 'confirmed' | 'pending'
  voucherUrl: string | null
}

/**
 * How a booking completes.
 *
 * `in_app`   - hold and confirm happen through the API, the traveler never leaves.
 * `deeplink` - the traveler is handed to the operator's checkout with tracking.
 *
 * Viator gates in-app booking behind Full+Booking affiliate or Merchant access,
 * so `deeplink` is the mode a plain affiliate key gets.
 */
export type BookingMode = 'in_app' | 'deeplink'

export interface ActivityProvider {
  readonly name: string
  readonly bookingMode: BookingMode
  /** True when the catalogue is generated rather than real inventory. */
  readonly isSample: boolean

  search(query: ActivitySearchQuery): Promise<Activity[]>
  get(productCode: string): Promise<Activity | null>
  availability(productCode: string, travelDate: string, partySize: number): Promise<AvailabilityOption[]>

  /** Present only in `in_app` mode. */
  hold?(request: HoldRequest): Promise<HoldResult>
  book?(request: BookRequest): Promise<BookResult>

  /** Present only in `deeplink` mode. */
  deeplink?(productCode: string): string
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
