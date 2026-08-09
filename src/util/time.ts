import { DateTime } from 'luxon'

export const FALLBACK_TIMEZONE = 'UTC'

export function nowUtcIso(): string {
  return new Date().toISOString()
}

function zoned(timezone: string | null | undefined): DateTime {
  const zone = timezone && timezone.length > 0 ? timezone : FALLBACK_TIMEZONE
  const dt = DateTime.now().setZone(zone)
  return dt.isValid ? dt : DateTime.now().setZone(FALLBACK_TIMEZONE)
}

/** Human-readable local time, e.g. "Thursday 9 August, 4:12 PM". */
export function localTimeLabel(timezone: string | null | undefined): string {
  return zoned(timezone).toFormat("cccc d LLLL, h:mm a")
}

/** Local calendar date as yyyy-MM-dd. */
export function localDate(timezone: string | null | undefined): string {
  return zoned(timezone).toFormat('yyyy-MM-dd')
}

export function localHour(timezone: string | null | undefined): number {
  return zoned(timezone).hour
}

/**
 * Quiet hours wrap midnight: start 21, end 8 means 21:00-07:59 is quiet.
 * If start === end, quiet hours are disabled.
 */
export function isQuietHour(
  timezone: string | null | undefined,
  startHour: number,
  endHour: number,
): boolean {
  if (startHour === endHour) return false
  const hour = localHour(timezone)
  return startHour > endHour
    ? hour >= startHour || hour < endHour
    : hour >= startHour && hour < endHour
}

/** UTC ISO timestamp of the most recent local midnight in `timezone`. */
export function startOfLocalDayUtcIso(timezone: string | null | undefined): string {
  const start = zoned(timezone).startOf('day').toUTC().toISO()
  return start ?? new Date(0).toISOString()
}

export function minutesSince(isoTimestamp: string | null | undefined): number {
  if (!isoTimestamp) return Number.POSITIVE_INFINITY
  const then = Date.parse(isoTimestamp)
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY
  return (Date.now() - then) / 60_000
}

/** Whole days from today (in `timezone`) until an ISO date. Null if unparseable. */
export function daysUntil(
  isoDate: string | null | undefined,
  timezone: string | null | undefined,
): number | null {
  if (!isoDate) return null
  const target = DateTime.fromISO(isoDate, { zone: timezone || FALLBACK_TIMEZONE })
  if (!target.isValid) return null
  const today = zoned(timezone).startOf('day')
  return Math.round(target.startOf('day').diff(today, 'days').days)
}
