import type { AgentTool } from '../llm/agent.js'
import { currentStay } from '../db/repo.js'
import { geocode } from '../services/geocode.js'
import { formatForecast, getForecast } from '../services/weather.js'
import { describeStay } from '../llm/state.js'

/**
 * Forecast for the traveler's current city, or for any place they name.
 * Deliberately one tool rather than two - the model shouldn't have to geocode
 * before it can ask about the weather somewhere.
 */
export function weatherTool(userId: string): AgentTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'get_weather',
        description:
          'Get the current conditions and multi-day forecast for a place. Omit `place` to get the forecast where the traveler currently is. Use this before recommending anything outdoors or time-of-day sensitive.',
        parameters: {
          type: 'object',
          properties: {
            place: {
              type: 'string',
              description:
                'City or place name to look up. Omit to use the traveler’s current location.',
            },
            days: {
              type: 'integer',
              description: 'How many days of forecast to return, 1 to 7. Defaults to 3.',
            },
          },
          required: [],
        },
      },
    },
    async run(input) {
      const days = typeof input.days === 'number' ? input.days : 3
      const place = typeof input.place === 'string' ? input.place.trim() : ''

      let latitude: number | null = null
      let longitude: number | null = null
      let label = place

      if (place) {
        const geo = await geocode(place)
        if (!geo) return `Could not find a place called "${place}".`
        latitude = geo.latitude
        longitude = geo.longitude
        label = [geo.name, geo.region, geo.country].filter(Boolean).join(', ')
      } else {
        const stay = currentStay(userId)
        if (!stay || stay.latitude === null || stay.longitude === null) {
          return 'The traveler’s current location is not known yet, so there is no default place to check. Ask them where they are, or pass an explicit `place`.'
        }
        latitude = stay.latitude
        longitude = stay.longitude
        label = describeStay(stay)
      }

      const forecast = await getForecast(latitude, longitude, days)
      if (!forecast) return `Weather lookup for ${label} failed. Do not guess at conditions.`
      return formatForecast(label, forecast)
    },
  }
}

/*
 * Web search was an Anthropic-hosted, model-invoked tool (`web_search_20260209`)
 * and was dropped in the move to OpenRouter, which has no equivalent: its web
 * plugin augments every request instead of being something the agent chooses to
 * call. Recommendations now rest on model knowledge plus the experience and
 * weather tools. The removed implementation is in git history if it is wanted
 * back behind a provider seam.
 */
