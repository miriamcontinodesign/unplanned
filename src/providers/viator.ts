import { config } from '../config.js'
import { describeError, logger } from '../util/log.js'
import type {
  Activity,
  ActivityProvider,
  ActivitySearchQuery,
  AvailabilityOption,
  BookRequest,
  BookResult,
  BookingMode,
  HoldRequest,
  HoldResult,
} from './types.js'
import { ProviderError } from './types.js'

const log = logger('viator')

/**
 * Viator Partner API client.
 *
 * VERIFIED against Viator's published documentation:
 *   - base URLs: https://api.viator.com/partner and https://api.sandbox.viator.com/partner
 *   - auth header: `exp-api-key`
 *   - endpoint paths used below
 *   - sort values DEFAULT / TRAVELER_RATING / PRICE
 *   - search must be scoped by destination, category or attraction
 *
 * NOT VERIFIED against a live key: the exact request body field names and the
 * response shapes. Viator's docs are client-rendered and could not be scraped,
 * and no API key was available to probe the sandbox. Everything uncertain is
 * confined to the `mapProduct` / `mapAvailability` functions and the request
 * builders at the bottom of this file - when a key arrives, those are the only
 * places that should need editing.
 *
 * Booking mode matters: transactional endpoints (`/bookings/cart/hold`,
 * `/bookings/cart/book`) require Full+Booking affiliate or Merchant access.
 * A plain affiliate key must use `deeplink` mode, where the traveler completes
 * the purchase on viator.com.
 */
export class ViatorProvider implements ActivityProvider {
  readonly name = 'viator'
  readonly isSample = false
  readonly bookingMode: BookingMode

  #baseUrl: string
  #apiKey: string
  #currency: string
  #partnerId: string | null

  constructor(options: {
    apiKey: string
    sandbox: boolean
    bookingMode: BookingMode
    currency?: string
    partnerId?: string | null
  }) {
    this.#apiKey = options.apiKey
    this.#baseUrl = options.sandbox
      ? 'https://api.sandbox.viator.com/partner'
      : 'https://api.viator.com/partner'
    this.bookingMode = options.bookingMode
    this.#currency = options.currency ?? 'USD'
    this.#partnerId = options.partnerId ?? null

    if (options.bookingMode === 'deeplink') {
      // Deeplink mode has no hold/book; drop the methods so callers can feature-detect.
      delete (this as Partial<ViatorProvider>).hold
      delete (this as Partial<ViatorProvider>).book
    } else {
      delete (this as Partial<ViatorProvider>).deeplink
    }
  }

  async #request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const response = await fetch(`${this.#baseUrl}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        'exp-api-key': this.#apiKey,
        // Viator versions the API through the Accept header rather than the path.
        Accept: 'application/json;version=2.0',
        'Accept-Language': 'en-US',
        ...(init?.body ? { 'Content-Type': 'application/json;version=2.0' } : {}),
      },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(20_000),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new ProviderError(
        `Viator ${path} failed with HTTP ${response.status}: ${detail.slice(0, 300)}`,
        response.status,
      )
    }
    return (await response.json()) as T
  }

  /**
   * Viator scopes product search by numeric destination id, so a place name has
   * to be resolved first. Results are cached for the process lifetime.
   */
  #destinationCache = new Map<string, string | null>()

  async #resolveDestinationId(destination: string): Promise<string | null> {
    const key = destination.trim().toLowerCase()
    const cached = this.#destinationCache.get(key)
    if (cached !== undefined) return cached

    try {
      const body = {
        searchTerm: destination,
        searchTypes: [{ searchType: 'DESTINATIONS', pagination: { start: 1, count: 1 } }],
        currency: this.#currency,
      }
      const result = await this.#request<ViatorFreetextResponse>('/search/freetext', {
        method: 'POST',
        body,
      })
      const id = result.destinations?.results?.[0]?.id
      const value = id === undefined || id === null ? null : String(id)
      this.#destinationCache.set(key, value)
      return value
    } catch (error) {
      log.warn(`destination lookup for "${destination}" failed`, describeError(error))
      this.#destinationCache.set(key, null)
      return null
    }
  }

  async search(query: ActivitySearchQuery): Promise<Activity[]> {
    const destinationId = await this.#resolveDestinationId(query.destination)
    if (!destinationId) {
      throw new ProviderError(`Viator has no destination matching "${query.destination}".`, 404)
    }

    const body: Record<string, unknown> = {
      filtering: {
        destination: destinationId,
        ...(query.fromDate && query.toDate
          ? { startDate: query.fromDate, endDate: query.toDate }
          : {}),
      },
      sorting: { sort: 'TRAVELER_RATING', order: 'DESCENDING' },
      pagination: { start: 1, count: Math.min(query.limit ?? 12, 50) },
      currency: this.#currency,
    }

    const result = await this.#request<ViatorSearchResponse>('/products/search', {
      method: 'POST',
      body,
    })

    return (result.products ?? []).map((product) => this.#mapProduct(product, query.destination))
  }

  async get(productCode: string): Promise<Activity | null> {
    try {
      const product = await this.#request<ViatorProduct>(
        `/products/${encodeURIComponent(productCode)}`,
      )
      return this.#mapProduct(product, product.destinations?.[0]?.name ?? '')
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) return null
      throw error
    }
  }

  async availability(
    productCode: string,
    travelDate: string,
    partySize: number,
  ): Promise<AvailabilityOption[]> {
    const result = await this.#request<ViatorAvailabilityResponse>('/availability/check', {
      method: 'POST',
      body: {
        productCode,
        travelDate,
        currency: this.#currency,
        paxMix: [{ ageBand: 'ADULT', numberOfTravelers: partySize }],
      },
    })

    return (result.bookableItems ?? []).map((item) => ({
      optionCode: item.productOptionCode ?? productCode,
      title: item.productOptionCode ?? 'Standard',
      startTime: item.startTime ?? null,
      total: {
        amount: item.totalPrice?.price?.recommendedRetailPrice ?? 0,
        currency: result.currency ?? this.#currency,
      },
      available: item.available !== false,
      cancellationPolicy: result.cancellationPolicy?.description ?? 'See operator terms.',
    }))
  }

  hold?(request: HoldRequest): Promise<HoldResult> {
    return this.#request<ViatorHoldResponse>('/bookings/cart/hold', {
      method: 'POST',
      body: {
        items: [
          {
            productCode: request.productCode,
            productOptionCode: request.optionCode,
            travelDate: request.travelDate,
            paxMix: [{ ageBand: 'ADULT', numberOfTravelers: request.partySize }],
          },
        ],
        currency: this.#currency,
      },
    }).then((response) => ({
      holdRef: response.cartRef ?? response.bookingRef ?? '',
      expiresAt:
        response.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
      total: {
        amount: response.totalPrice?.price?.recommendedRetailPrice ?? 0,
        currency: this.#currency,
      },
      cancellationPolicy: response.cancellationPolicy?.description ?? 'See operator terms.',
    }))
  }

  book?(request: BookRequest): Promise<BookResult> {
    return this.#request<ViatorBookResponse>('/bookings/cart/book', {
      method: 'POST',
      body: {
        cartRef: request.holdRef,
        currency: this.#currency,
        communication: { email: request.traveler.email },
        booker: {
          firstName: request.traveler.firstName,
          lastName: request.traveler.lastName,
          email: request.traveler.email,
        },
      },
    }).then((response) => ({
      bookingRef: response.bookingRef ?? response.itemId ?? '',
      status: response.status === 'CONFIRMED' ? ('confirmed' as const) : ('pending' as const),
      voucherUrl: response.voucherUrl ?? null,
    }))
  }

  /**
   * Affiliate handoff. The traveler completes payment on viator.com; the
   * partner id is what attributes the sale back to us.
   */
  deeplink?(productCode: string): string {
    const url = new URL(`https://www.viator.com/tours/${encodeURIComponent(productCode)}`)
    if (this.#partnerId) url.searchParams.set('pid', this.#partnerId)
    url.searchParams.set('mcid', '42383')
    url.searchParams.set('medium', 'api')
    return url.toString()
  }

  // ---------------------------------------------------------------------------
  // Response mapping. This is the unverified surface - see the class docstring.
  // ---------------------------------------------------------------------------

  #mapProduct(product: ViatorProduct, fallbackDestination: string): Activity {
    const price = product.pricing?.summary?.fromPrice ?? product.pricing?.summary?.fromPriceBeforeDiscount
    const durationMinutes =
      product.duration?.fixedDurationInMinutes ??
      product.duration?.variableDurationFromMinutes ??
      0

    return {
      provider: this.name,
      productCode: product.productCode,
      title: product.title ?? 'Untitled experience',
      summary: product.description ?? '',
      destination: product.destinations?.[0]?.name ?? fallbackDestination,
      durationMinutes,
      rating: product.reviews?.combinedAverageRating ?? null,
      reviewCount: product.reviews?.totalReviews ?? null,
      fromPrice: { amount: price ?? 0, currency: product.pricing?.currency ?? this.#currency },
      imageUrl: product.images?.[0]?.variants?.at(-1)?.url ?? null,
      tags: (product.tags ?? []).map(String),
      freeCancellation: product.flags?.includes('FREE_CANCELLATION') ?? false,
      productUrl: product.productUrl ?? null,
    }
  }
}

export function viatorFromConfig(): ViatorProvider {
  if (!config.viator.apiKey) {
    throw new Error(
      'ROADIO_ACTIVITY_PROVIDER=viator requires VIATOR_API_KEY. Set it, or use the sample provider.',
    )
  }
  return new ViatorProvider({
    apiKey: config.viator.apiKey,
    sandbox: config.viator.sandbox,
    bookingMode: config.viator.bookingMode,
    currency: config.viator.currency,
    partnerId: config.viator.partnerId,
  })
}

// --- Response shapes (best-effort; adjust against a live key) -----------------

interface ViatorFreetextResponse {
  destinations?: { results?: Array<{ id?: number | string; name?: string }> }
}

interface ViatorSearchResponse {
  products?: ViatorProduct[]
  totalCount?: number
}

interface ViatorProduct {
  productCode: string
  title?: string
  description?: string
  productUrl?: string
  tags?: Array<number | string>
  flags?: string[]
  destinations?: Array<{ ref?: string; name?: string }>
  duration?: {
    fixedDurationInMinutes?: number
    variableDurationFromMinutes?: number
  }
  reviews?: { combinedAverageRating?: number; totalReviews?: number }
  images?: Array<{ variants?: Array<{ url?: string; height?: number; width?: number }> }>
  pricing?: {
    currency?: string
    summary?: { fromPrice?: number; fromPriceBeforeDiscount?: number }
  }
}

interface ViatorAvailabilityResponse {
  currency?: string
  bookableItems?: Array<{
    productOptionCode?: string
    startTime?: string
    available?: boolean
    totalPrice?: { price?: { recommendedRetailPrice?: number } }
  }>
  cancellationPolicy?: { description?: string }
}

interface ViatorHoldResponse {
  cartRef?: string
  bookingRef?: string
  expiresAt?: string
  totalPrice?: { price?: { recommendedRetailPrice?: number } }
  cancellationPolicy?: { description?: string }
}

interface ViatorBookResponse {
  bookingRef?: string
  itemId?: string
  status?: string
  voucherUrl?: string
}
