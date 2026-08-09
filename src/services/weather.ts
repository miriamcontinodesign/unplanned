import { describeWeatherCode } from './wmo.js'
import { describeError, logger } from '../util/log.js'

const log = logger('weather')

export interface DailyForecast {
  date: string
  conditions: string
  highC: number | null
  lowC: number | null
  precipitationChance: number | null
  sunrise: string | null
  sunset: string | null
}

export interface Forecast {
  timezone: string
  current: { temperatureC: number | null; conditions: string } | null
  days: DailyForecast[]
}

interface OpenMeteoForecastResponse {
  timezone?: string
  current?: { temperature_2m?: number; weather_code?: number }
  daily?: {
    time?: string[]
    weather_code?: number[]
    temperature_2m_max?: number[]
    temperature_2m_min?: number[]
    precipitation_probability_max?: number[]
    sunrise?: string[]
    sunset?: string[]
  }
}

export async function getForecast(
  latitude: number,
  longitude: number,
  days = 3,
): Promise<Forecast | null> {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('longitude', String(longitude))
  url.searchParams.set('current', 'temperature_2m,weather_code')
  url.searchParams.set(
    'daily',
    'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
  )
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', String(Math.min(Math.max(days, 1), 7)))

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) {
      log.warn(`forecast failed with HTTP ${response.status}`)
      return null
    }
    const body = (await response.json()) as OpenMeteoForecastResponse
    const daily = body.daily
    const dates = daily?.time ?? []

    return {
      timezone: body.timezone ?? 'UTC',
      current: body.current
        ? {
            temperatureC: body.current.temperature_2m ?? null,
            conditions: describeWeatherCode(body.current.weather_code),
          }
        : null,
      days: dates.map((date, i) => ({
        date,
        conditions: describeWeatherCode(daily?.weather_code?.[i]),
        highC: daily?.temperature_2m_max?.[i] ?? null,
        lowC: daily?.temperature_2m_min?.[i] ?? null,
        precipitationChance: daily?.precipitation_probability_max?.[i] ?? null,
        sunrise: daily?.sunrise?.[i] ?? null,
        sunset: daily?.sunset?.[i] ?? null,
      })),
    }
  } catch (error) {
    log.warn('forecast threw', describeError(error))
    return null
  }
}

export function formatForecast(place: string, forecast: Forecast): string {
  const lines: string[] = [`Weather for ${place} (timezone ${forecast.timezone}):`]

  if (forecast.current) {
    const temp =
      forecast.current.temperatureC === null ? 'unknown' : `${forecast.current.temperatureC}C`
    lines.push(`Right now: ${forecast.current.conditions}, ${temp}.`)
  }

  for (const day of forecast.days) {
    const range =
      day.lowC === null || day.highC === null ? 'temperature unknown' : `${day.lowC}-${day.highC}C`
    const rain =
      day.precipitationChance === null
        ? 'precipitation chance unknown'
        : `${day.precipitationChance}% chance of precipitation`
    const sun =
      day.sunrise && day.sunset
        ? `, sunrise ${day.sunrise.slice(11)} sunset ${day.sunset.slice(11)}`
        : ''
    lines.push(`${day.date}: ${day.conditions}, ${range}, ${rain}${sun}.`)
  }

  return lines.join('\n')
}
