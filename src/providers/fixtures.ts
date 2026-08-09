import { randomUUID } from 'node:crypto'
import { seededUnit } from '../util/ids.js'
import type {
  Activity,
  ActivityProvider,
  ActivitySearchQuery,
  AvailabilityOption,
  BookRequest,
  BookResult,
  HoldRequest,
  HoldResult,
} from './types.js'
import { ProviderError } from './types.js'

/**
 * Archetypes the sample catalogue is built from. Each destination gets a stable
 * catalogue derived from its name, so the same city always yields the same
 * tours, prices and ratings across requests and restarts.
 */
interface Archetype {
  slug: string
  title: (city: string) => string
  summary: (city: string) => string
  tags: string[]
  baseUsd: number
  minutes: number
}

const ARCHETYPES: Archetype[] = [
  {
    slug: 'street-food',
    title: (c) => `${c} Street Food & Market Crawl`,
    summary: (c) =>
      `Six tastings across two neighbourhoods with a guide who actually eats here. Ends at a market stall locals queue for, not the one on the postcards of ${c}.`,
    tags: ['food', 'local', 'walking'],
    baseUsd: 68,
    minutes: 210,
  },
  {
    slug: 'cooking-class',
    title: (c) => `Cooking Class in a ${c} Home Kitchen`,
    summary: () =>
      'Shop the morning market with your host, then cook three regional dishes in their kitchen and eat what you made. Small group, wine included.',
    tags: ['food', 'hands-on', 'local'],
    baseUsd: 95,
    minutes: 240,
  },
  {
    slug: 'old-town',
    title: (c) => `${c} Old Town Walking Tour`,
    summary: (c) =>
      `Two and a half hours through the historic core of ${c} with a guide who reads the architecture like a document. Good first-day orientation.`,
    tags: ['history', 'walking', 'culture'],
    baseUsd: 42,
    minutes: 150,
  },
  {
    slug: 'museum-skip',
    title: (c) => `${c} Museum Skip-the-Line & Guided Highlights`,
    summary: () =>
      'Timed entry plus a ninety-minute guided route through the collection that matters, then stay as long as you like on your own.',
    tags: ['art', 'history', 'culture', 'indoor'],
    baseUsd: 55,
    minutes: 180,
  },
  {
    slug: 'day-trip',
    title: (c) => `Day Trip from ${c}: Valleys & Villages`,
    summary: (c) =>
      `Full day out of ${c} by minibus with three stops, a long lunch, and enough unscheduled time to actually wander. Back by early evening.`,
    tags: ['outdoors', 'scenic', 'day-trip'],
    baseUsd: 130,
    minutes: 540,
  },
  {
    slug: 'sunrise-hike',
    title: (c) => `Sunrise Hike Above ${c}`,
    summary: () =>
      'Early pickup, a moderate two-hour ascent, and breakfast at the top while the light comes up. Boots and a warm layer required.',
    tags: ['outdoors', 'active', 'scenic'],
    baseUsd: 78,
    minutes: 330,
  },
  {
    slug: 'sunset-cruise',
    title: (c) => `${c} Sunset Cruise with Drinks`,
    summary: () =>
      'Two hours on the water timed to golden hour, with a drink in hand and far fewer people than the daytime sailings.',
    tags: ['water', 'scenic', 'relaxed'],
    baseUsd: 88,
    minutes: 120,
  },
  {
    slug: 'street-art',
    title: (c) => `${c} Street Art & Independent Galleries`,
    summary: () =>
      'A walk through the districts where the work actually lives, with stops at two artist-run spaces and a coffee that is worth the detour.',
    tags: ['art', 'offbeat', 'walking'],
    baseUsd: 46,
    minutes: 165,
  },
  {
    slug: 'cocktail-crawl',
    title: (c) => `${c} Craft Cocktail Crawl`,
    summary: () =>
      'Four bars, four drinks, one guide who knows every bartender by name. Starts late enough to follow dinner.',
    tags: ['nightlife', 'food', 'social'],
    baseUsd: 92,
    minutes: 195,
  },
  {
    slug: 'bike-ride',
    title: (c) => `${c} by Bike: Backstreets Route`,
    summary: (c) =>
      `Twelve mostly flat kilometres on quiet streets, covering the parts of ${c} that walking tours never reach. E-bikes available.`,
    tags: ['active', 'offbeat', 'outdoors'],
    baseUsd: 58,
    minutes: 210,
  },
  {
    slug: 'thermal-baths',
    title: (c) => `Thermal Baths & Spa Afternoon near ${c}`,
    summary: () =>
      'Half a day of hot pools, steam rooms and a cold plunge, with towel and locker included. The unhurried option for a rainy afternoon.',
    tags: ['wellness', 'relaxed', 'indoor'],
    baseUsd: 74,
    minutes: 270,
  },
  {
    slug: 'photo-walk',
    title: (c) => `Golden Hour Photo Walk in ${c}`,
    summary: () =>
      'A photographer takes you to six locations timed to the light and helps with composition on whatever camera you brought, phone included.',
    tags: ['offbeat', 'scenic', 'walking'],
    baseUsd: 64,
    minutes: 150,
  },
  {
    slug: 'wine-tasting',
    title: (c) => `Wine & Small Plates Tasting, ${c}`,
    summary: () =>
      'Six pours from producers within a couple of hours of here, each with something to eat alongside it. Seated, unhurried, indoors.',
    tags: ['food', 'relaxed', 'indoor'],
    baseUsd: 82,
    minutes: 150,
  },
  {
    slug: 'private-guide',
    title: (c) => `Private Guide for a Day in ${c}`,
    summary: () =>
      'Your own guide and vehicle for eight hours, itinerary built around what you actually want to see. The flexible, unrushed option.',
    tags: ['private', 'culture', 'flexible'],
    baseUsd: 340,
    minutes: 480,
  },
]

const BUDGET_CEILING: Record<string, number> = {
  shoestring: 60,
  moderate: 120,
  comfortable: 260,
  luxury: Number.POSITIVE_INFINITY,
}

interface HoldRecord {
  request: HoldRequest
  expiresAt: number
  total: number
  currency: string
}

/**
 * A fully working catalogue that needs no credentials, so the whole search ->
 * hold -> confirm path is exercisable end to end. Marked `isSample` so the UI
 * can be explicit that this is not real inventory.
 */
export class FixtureProvider implements ActivityProvider {
  readonly name = 'sample'
  readonly bookingMode = 'in_app' as const
  readonly isSample = true

  #holds = new Map<string, HoldRecord>()

  /**
   * Everything this provider has generated, keyed by product code. A booking
   * always follows a search, so this is warm by the time it matters; decoding
   * the code is only the cold-start fallback.
   */
  #index = new Map<string, Activity>()

  #catalogue(destination: string): Activity[] {
    const city = destination.split(',')[0]!.trim() || destination.trim()

    const catalogue = ARCHETYPES.map((archetype) => {
      const seed = `${city.toLowerCase()}:${archetype.slug}`
      const priceJitter = 0.8 + seededUnit(seed, 'price') * 0.5
      const amount = Math.round(archetype.baseUsd * priceJitter)
      const rating = Number((4.1 + seededUnit(seed, 'rating') * 0.85).toFixed(1))
      const reviewCount = 40 + Math.floor(seededUnit(seed, 'reviews') * 2600)

      return {
        provider: this.name,
        // Underscores separate the segments because both the city slug and the
        // archetype slug contain hyphens, which would make the code ambiguous.
        productCode: `SAMPLE_${slugify(city)}_${archetype.slug.toUpperCase()}`,
        title: archetype.title(city),
        summary: archetype.summary(city),
        destination: city,
        durationMinutes: archetype.minutes,
        rating,
        reviewCount,
        fromPrice: { amount, currency: 'USD' },
        imageUrl: null,
        tags: archetype.tags,
        freeCancellation: seededUnit(seed, 'cancel') > 0.25,
        productUrl: null,
      } satisfies Activity
    })

    for (const activity of catalogue) this.#index.set(activity.productCode, activity)
    return catalogue
  }

  async search(query: ActivitySearchQuery): Promise<Activity[]> {
    const interests = (query.interests ?? []).map((i) => i.toLowerCase().trim()).filter(Boolean)
    const ceiling = query.budgetLevel ? BUDGET_CEILING[query.budgetLevel] ?? Infinity : Infinity

    const scored = this.#catalogue(query.destination)
      .filter((activity) => activity.fromPrice.amount <= ceiling)
      .map((activity) => {
        const overlap = activity.tags.filter((tag) =>
          interests.some((interest) => tag.includes(interest) || interest.includes(tag)),
        ).length
        // Interest match dominates; rating breaks ties among equally relevant tours.
        return { activity, score: overlap * 10 + (activity.rating ?? 0) }
      })
      .sort((a, b) => b.score - a.score)

    return scored.slice(0, query.limit ?? 12).map((entry) => entry.activity)
  }

  async get(productCode: string): Promise<Activity | null> {
    const seen = this.#index.get(productCode)
    if (seen) return seen

    const city = cityFromCode(productCode)
    if (!city) return null
    return this.#catalogue(city).find((a) => a.productCode === productCode) ?? null
  }

  async availability(
    productCode: string,
    travelDate: string,
    partySize: number,
  ): Promise<AvailabilityOption[]> {
    const activity = await this.get(productCode)
    if (!activity) throw new ProviderError(`Unknown product ${productCode}`, 404)

    const times = activity.durationMinutes > 300 ? ['08:00'] : ['09:30', '14:00', '17:30']

    return times.map((startTime, index) => {
      const seed = `${productCode}:${travelDate}:${startTime}`
      const surcharge = index === times.length - 1 ? 1.08 : 1
      const perPerson = Math.round(activity.fromPrice.amount * surcharge)

      return {
        optionCode: `${productCode}-${startTime.replace(':', '')}`,
        title: times.length === 1 ? 'Standard departure' : `Departure ${startTime}`,
        startTime,
        total: { amount: perPerson * partySize, currency: activity.fromPrice.currency },
        // Deterministically sell out one slot now and then, so the UI has to
        // handle unavailability rather than assuming a happy path.
        available: seededUnit(seed, 'avail') > 0.15,
        cancellationPolicy: activity.freeCancellation
          ? 'Free cancellation up to 24 hours before the start time.'
          : 'Non-refundable once confirmed.',
      }
    })
  }

  async hold(request: HoldRequest): Promise<HoldResult> {
    const options = await this.availability(
      request.productCode,
      request.travelDate,
      request.partySize,
    )
    const option = options.find((o) => o.optionCode === request.optionCode)
    if (!option) throw new ProviderError('That departure is no longer offered.', 409)
    if (!option.available) throw new ProviderError('That departure just sold out.', 409)

    const holdRef = `HOLD-${randomUUID().slice(0, 8).toUpperCase()}`
    const expiresAt = Date.now() + 15 * 60_000
    this.#holds.set(holdRef, {
      request,
      expiresAt,
      total: option.total.amount,
      currency: option.total.currency,
    })

    return {
      holdRef,
      expiresAt: new Date(expiresAt).toISOString(),
      total: option.total,
      cancellationPolicy: option.cancellationPolicy,
    }
  }

  async book(request: BookRequest): Promise<BookResult> {
    const held = this.#holds.get(request.holdRef)
    if (!held) throw new ProviderError('That hold has expired. Please pick a time again.', 409)
    if (held.expiresAt < Date.now()) {
      this.#holds.delete(request.holdRef)
      throw new ProviderError('That hold has expired. Please pick a time again.', 409)
    }

    this.#holds.delete(request.holdRef)
    return {
      bookingRef: `SMPL-${randomUUID().slice(0, 6).toUpperCase()}`,
      status: 'confirmed',
      voucherUrl: null,
    }
  }
}

function slugify(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toUpperCase() || 'CITY'
  )
}

/**
 * Cold-start fallback: recover a destination from a sample product code.
 * The code is uppercase, so title-case it rather than rendering "LIMA".
 */
function cityFromCode(productCode: string): string | null {
  const match = /^SAMPLE_([^_]+)_(.+)$/.exec(productCode)
  if (!match) return null
  return match[1]!
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ')
}
