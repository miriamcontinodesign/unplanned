import type { AgentTool } from '../llm/agent.js'
import { config } from '../config.js'
import { formatExperienceResults, searchExperiences } from '../services/viator.js'
import { searchMockExperiences } from './viator.mock.js'

/**
 * Public Roadio component for Viator's bookable experience search.
 *
 * Protocol, connection, retry, and formatting details stay behind this small
 * AgentTool boundary, so the main concierge can opt into the component without
 * knowing anything about MCP.
 */
export function experienceSearchTool(userId: string): AgentTool {
  return {
    definition: {
      name: 'search_experiences',
      description:
        'Search Viator for current, bookable tours and activities. Use for experience recommendations when the traveler gives, or their trip context establishes, a destination and participation date. Results include live product links; searching does not check out or book anything.',
      input_schema: {
        type: 'object',
        properties: {
          searchTerm: {
            type: 'string',
            description:
              'Destination, activity, and preferences only, e.g. "family-friendly food tours in Rome". Do not put dates, prices, duration, or currency here.',
          },
          startDate: {
            type: 'string',
            description: 'First participation date in YYYY-MM-DD format; cannot be in the past.',
          },
          endDate: {
            type: 'string',
            description: 'Last participation date in YYYY-MM-DD format. Use the start date for a single day.',
          },
          duration: {
            type: 'integer',
            description: 'Optional maximum duration in minutes.',
          },
          fromPrice: {
            type: 'number',
            description: 'Optional minimum per-person price.',
          },
          toPrice: {
            type: 'number',
            description: 'Optional maximum per-person price.',
          },
          currency: {
            type: 'string',
            description: 'ISO 4217 currency code. Defaults to USD.',
          },
          locale: {
            type: 'string',
            description: 'Content locale such as en-US. Defaults to en.',
          },
          limit: {
            type: 'integer',
            description: 'Number of results, 1 to 10. Defaults to 3; prefer three strong choices.',
          },
        },
        required: ['searchTerm', 'startDate', 'endDate'],
      },
    },
    async run(input) {
      const searchTerm = typeof input.searchTerm === 'string' ? input.searchTerm.trim() : ''
      const startDate = typeof input.startDate === 'string' ? input.startDate.trim() : ''
      const endDate = typeof input.endDate === 'string' ? input.endDate.trim() : ''
      const datePattern = /^\d{4}-\d{2}-\d{2}$/
      if (!searchTerm) return '`searchTerm` is required.'
      if (!datePattern.test(startDate) || !datePattern.test(endDate)) {
        return '`startDate` and `endDate` must use YYYY-MM-DD.'
      }
      if (endDate < startDate) return '`endDate` must be on or after `startDate`.'

      const currency = typeof input.currency === 'string'
        ? input.currency.trim().toUpperCase()
        : 'USD'
      if (!/^[A-Z]{3}$/.test(currency)) return '`currency` must be a three-letter ISO code.'

      const number = (name: string): number | undefined =>
        typeof input[name] === 'number' && Number.isFinite(input[name])
          ? input[name] as number
          : undefined

      const searchInput = {
        searchTerm,
        startDate,
        endDate,
        duration: number('duration'),
        fromPrice: number('fromPrice'),
        toPrice: number('toPrice'),
        currency,
        locale: typeof input.locale === 'string' ? input.locale.trim() : 'en',
        limit: number('limit') ?? 3,
      }
      const result = config.viatorMock
        ? searchMockExperiences(userId, searchInput)
        : await searchExperiences(userId, searchInput)
      return formatExperienceResults(result, currency)
    },
  }
}
