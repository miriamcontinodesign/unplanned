import type Anthropic from '@anthropic-ai/sdk'
import type { AgentTool } from '../llm/agent.js'
import { currentStay, type Stay } from '../db/repo.js'
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
      name: 'get_weather',
      description:
        'Get the current conditions and multi-day forecast for a place. Omit `place` to get the forecast where the traveler currently is. Use this before recommending anything outdoors or time-of-day sensitive.',
      input_schema: {
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

/**
 * Anthropic-hosted web search. Passing the traveler's location biases results
 * toward what is actually near them, which is most of the value here.
 */
export function webSearchTool(stay: Stay | undefined): AgentTool {
  const definition: Anthropic.Messages.ToolUnion = {
    type: 'web_search_20260209',
    name: 'web_search',
    max_uses: 6,
  }

  if (stay?.city) {
    // `country` must be ISO 3166-1 alpha-2. We only ever set it from the
    // geocoder's country_code, never from the free-text country name, so an
    // ungeocoded stay simply omits it rather than sending something invalid.
    ;(definition as Anthropic.Messages.WebSearchTool20260209).user_location = {
      type: 'approximate',
      city: stay.city,
      ...(stay.region ? { region: stay.region } : {}),
      ...(stay.countryCode ? { country: stay.countryCode } : {}),
      ...(stay.timezone ? { timezone: stay.timezone } : {}),
    }
  }

  return { definition }
}

export interface NudgeSink {
  value: { topic: string; message: string } | null
}

/**
 * The proactive engine's only side effect. The model calls this when it decides
 * a message is worth sending; not calling it is the equivalent of staying quiet.
 */
export function sendNudgeTool(sink: NudgeSink): AgentTool {
  return {
    definition: {
      name: 'send_nudge',
      description:
        'Send an unprompted message to the traveler. Call this at most once, and only when the suggestion clears the bar described in your instructions. If nothing is worth sending, do not call this tool at all - just end your turn.',
      input_schema: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description:
              'Short kebab-case label for what this suggestion is about, e.g. "sunset-walk" or "rain-backup-plan". Used to avoid repeating yourself later.',
          },
          message: {
            type: 'string',
            description:
              'The message to send, as one short text. Two to three sentences. No greeting.',
          },
        },
        required: ['topic', 'message'],
      },
    },
    async run(input) {
      const topic = typeof input.topic === 'string' ? input.topic.trim() : ''
      const message = typeof input.message === 'string' ? input.message.trim() : ''
      if (!topic || !message) return 'Both `topic` and `message` are required.'
      sink.value = { topic, message }
      return 'Queued. End your turn now - do not send another.'
    },
  }
}
