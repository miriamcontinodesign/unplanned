import { searchExperiences } from '../services/viator.js'
import type { Activity, ActivityProvider, ActivitySearchQuery, AvailabilityOption } from './types.js'

function minutes(duration: { fixedDurationInMinutes?: number; variableDurationFromMinutes?: number; variableDurationToMinutes?: number } | undefined): number {
  return duration?.fixedDurationInMinutes ?? duration?.variableDurationFromMinutes ?? duration?.variableDurationToMinutes ?? 120
}

function imageUrl(template: string | undefined): string | null {
  return template?.replace('{w}', '640').replace('{h}', '480') ?? null
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
    const interests = query.interests?.length ? `, ${query.interests.join(', ')}` : ''
    const result = await searchExperiences(query.userId, {
      searchTerm: `tours and activities in ${query.destination}${interests}`,
      startDate: query.fromDate,
      endDate: query.toDate,
      currency: 'USD',
      locale: 'en-US',
      limit: query.limit,
    })

    return result.experiences.map((experience) => {
      const category = experience.keyAttributes?.mainCategory?.trim() || 'Experience'
      const features = experience.keyAttributes?.features?.filter(Boolean) ?? []
      const activity: Activity = {
        provider: this.name,
        productCode: experience.code,
        title: experience.title,
        summary: features.length > 0 ? features.slice(0, 3).join(' · ') : `${category} available through Viator.`,
        destination: query.destination,
        durationMinutes: minutes(experience.duration),
        rating: experience.rating ?? null,
        reviewCount: experience.reviewCount ?? null,
        fromPrice: { amount: experience.fromPrice ?? 0, currency: 'USD' },
        imageUrl: imageUrl(experience.thumbnail),
        tags: [category, ...features].map((value) => value.toLowerCase()),
        freeCancellation: experience.freeCancellation,
        productUrl: experience.clickOffToLander,
        meetingPoint: null,
      }
      this.#index.set(activity.productCode, activity)
      return activity
    })
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
