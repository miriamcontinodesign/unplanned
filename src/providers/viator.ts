import { searchExperiences, type ViatorExperience } from '../services/viator.js'
import { BUDGET_CEILING } from './types.js'
import type { Activity, ActivityProvider, ActivitySearchQuery, AvailabilityOption } from './types.js'

function minutes(duration: { fixedDurationInMinutes?: number; variableDurationFromMinutes?: number; variableDurationToMinutes?: number } | undefined): number {
  return duration?.fixedDurationInMinutes ?? duration?.variableDurationFromMinutes ?? duration?.variableDurationToMinutes ?? 120
}

function imageUrl(template: string | undefined): string | null {
  return template?.replace('{w}', '400').replace('{h}', '400') ?? null
}

function featureLabel(value: string): string {
  const label = value.replace(/_/g, ' ').trim().toLowerCase()
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** A Viator experience as a recommendation card. */
export function toActivity(experience: ViatorExperience, destination: string): Activity {
  const category = experience.keyAttributes?.mainCategory?.trim() || 'Experience'
  const features = experience.keyAttributes?.features?.filter(Boolean) ?? []
  return {
    provider: 'viator',
    productCode: experience.code,
    title: experience.title,
    summary: features.length > 0 ? features.slice(0, 3).map(featureLabel).join(' · ') : '',
    destination,
    durationMinutes: minutes(experience.duration),
    rating: experience.rating ?? null,
    reviewCount: experience.reviewCount ?? null,
    fromPrice: { amount: experience.fromPrice ?? 0, currency: 'USD' },
    imageUrl: imageUrl(experience.thumbnail),
    tags: [category, ...features].map((value) => value.toLowerCase()),
    category,
    freeCancellation: experience.freeCancellation,
    productUrl: experience.clickOffToLander,
    meetingPoint: null,
  }
}

/** Live Viator search adapter used by the web recommendation feed. */
export class ViatorProvider implements ActivityProvider {
  readonly name = 'viator'
  readonly bookingMode = 'deeplink' as const
  readonly isSample = false
  #index = new Map<string, Activity>()

  async search(query: ActivitySearchQuery): Promise<Activity[]> {
    if (!query.userId || !query.fromDate || !query.toDate) {
      throw new Error('Viator search requires a traveler and participation dates.')
    }

    // Fold what the traveler has actually told the bot into the search itself,
    // rather than filtering a generic result afterwards - Viator's search is
    // semantic text, so party size and taste steer which experiences surface
    // at all, not just how they're ranked once back.
    const interests = query.interests?.length ? `, ${query.interests.join(', ')}` : ''
    const party =
      query.partySize && query.partySize > 1 ? `, for a group of ${query.partySize}` : ''
    const ceiling = query.budgetLevel ? BUDGET_CEILING[query.budgetLevel] : undefined

    const result = await searchExperiences(query.userId, {
      searchTerm: `tours and activities in ${query.destination}${interests}${party}`,
      startDate: query.fromDate,
      endDate: query.toDate,
      currency: 'USD',
      locale: 'en-US',
      limit: query.limit,
      ...(ceiling !== undefined && Number.isFinite(ceiling) ? { toPrice: ceiling } : {}),
    })

    return result.experiences.map((experience) => {
      const activity = toActivity(experience, query.destination)
      this.#index.set(activity.productCode, activity)
      return activity
    })
  }

  /** Registers cards produced outside `search`, so accept, pass and booking can still find them. */
  remember(activities: Activity[]): void {
    for (const activity of activities) this.#index.set(activity.productCode, activity)
  }

  async get(productCode: string): Promise<Activity | null> {
    return this.#index.get(productCode) ?? null
  }

  async availability(): Promise<AvailabilityOption[]> {
    return []
  }

  deeplink(productCode: string): string {
    return this.#index.get(productCode)?.productUrl ?? 'https://www.viator.com/'
  }
}
