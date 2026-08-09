/**
 * Client for the concierge-line voice module (concierge-line/, Python, :8000).
 *
 * That module phones a restaurant, bar or tour operator and books a real table.
 * This file is the seam: it turns an itinerary plan from an *idea* into a
 * *booking* that somebody actually confirmed on the phone.
 *
 * Deliberately standalone and non-invasive:
 *  - no new dependencies (global fetch, Node 20+)
 *  - if the voice module is not running, every call here resolves to null and
 *    the caller carries on exactly as it does today
 *  - nothing here throws into a request path
 *
 * See `concierge-line/README.md` for the wire contract, and the bottom of this
 * file for the six lines that wire it into `src/http/server.ts`.
 */

import { logger } from '../util/log.js'

const log = logger('concierge')

/** The voice module's base URL. Blank disables the integration entirely. */
function baseUrl(): string {
  return (process.env.CONCIERGE_LINE_URL ?? 'http://127.0.0.1:8000').trim().replace(/\/$/, '')
}

export function conciergeEnabled(): boolean {
  return baseUrl().length > 0
}

export interface BookingRequest {
  /** What to call, e.g. "Bar Tulia". */
  venueName: string
  venueKind?: 'restaurant' | 'bar' | 'tour'
  venueAddress?: string | null
  /** YYYY-MM-DD. */
  date: string
  /** 24h HH:MM. */
  time: string
  partySize: number
  travelerName?: string | null
  /** Anything the venue should know: "anniversary, table outside". */
  notes?: string | null
}

export interface BookingState {
  taskId: string
  /** queued | dialing | in_progress | completed | failed */
  status: string
  /** True only once the venue confirmed on the call. Null while unknown. */
  confirmed: boolean | null
  /** As the venue said it, e.g. "8:45 PM". */
  confirmedTime: string | null
  alternativesOffered: string[]
  /** Traveler-facing sentence, safe to show verbatim. */
  note: string | null
  transcriptTurns: number
}

/** Shape of concierge-line's task JSON. Only the fields we read. */
interface TaskPayload {
  id?: unknown
  status?: unknown
  summary_markdown?: unknown
  transcript?: unknown
  result?: {
    reservation_confirmed?: unknown
    confirmed_time?: unknown
    alternatives_offered?: unknown
  } | null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function toState(payload: TaskPayload): BookingState | null {
  const taskId = asString(payload.id)
  if (taskId === null) return null

  const result = payload.result ?? null
  const alternatives = Array.isArray(result?.alternatives_offered)
    ? result.alternatives_offered.filter((item): item is string => typeof item === 'string')
    : []

  return {
    taskId,
    status: asString(payload.status) ?? 'unknown',
    confirmed: typeof result?.reservation_confirmed === 'boolean' ? result.reservation_confirmed : null,
    confirmedTime: asString(result?.confirmed_time),
    alternativesOffered: alternatives,
    note: asString(payload.summary_markdown),
    transcriptTurns: Array.isArray(payload.transcript) ? payload.transcript.length : 0,
  }
}

async function call(path: string, init?: RequestInit): Promise<unknown | null> {
  if (!conciergeEnabled()) return null
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) {
      log.warn(`${path} returned HTTP ${response.status}`)
      return null
    }
    return await response.json()
  } catch (error) {
    // The voice module being down must never break an itinerary request.
    log.warn(`${path} unreachable`, error)
    return null
  }
}

/** True when the voice module is up and actually able to place calls. */
export async function conciergeReady(): Promise<boolean> {
  const health = (await call('/api/health')) as { ok?: unknown; fake_call_mode?: unknown } | null
  return health?.ok === true && health.fake_call_mode === false
}

/**
 * Create the call task and start dialling. Returns immediately - the call runs
 * in the background on the voice module, so this never blocks a request.
 */
export async function startBooking(request: BookingRequest): Promise<string | null> {
  const created = (await call('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      venue: {
        name: request.venueName,
        kind: request.venueKind ?? 'restaurant',
        address: request.venueAddress ?? '',
      },
      request: {
        date: request.date,
        time: request.time,
        party_size: request.partySize,
      },
      traveler: {
        name: request.travelerName ?? '',
        notes: request.notes ?? '',
      },
    }),
  })) as TaskPayload | null

  const taskId = asString(created?.id)
  if (taskId === null) return null

  const started = await call(`/api/tasks/${taskId}/call`, { method: 'POST' })
  if (started === null) {
    log.warn(`created task ${taskId} but could not start the call`)
    return null
  }

  log.info(`calling ${request.venueName} for ${request.partySize} on ${request.date}`, { taskId })
  return taskId
}

export async function bookingState(taskId: string): Promise<BookingState | null> {
  const payload = (await call(`/api/tasks/${taskId}`)) as TaskPayload | null
  return payload === null ? null : toState(payload)
}

/**
 * Poll until the call settles, then hand the final state to `onSettled`.
 *
 * Returns a stop function. Fire-and-forget from a request handler: the HTTP
 * response goes back immediately and this resolves the booking in the
 * background, which is what lets the UI show the confirmation arriving live.
 */
export function watchBooking(
  taskId: string,
  onSettled: (state: BookingState) => void,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): () => void {
  const intervalMs = options.intervalMs ?? 1500
  const deadline = Date.now() + (options.timeoutMs ?? 5 * 60_000)
  let stopped = false

  const timer = setInterval(() => {
    if (stopped) return
    if (Date.now() > deadline) {
      log.warn(`gave up waiting on ${taskId}`)
      stop()
      return
    }
    void bookingState(taskId).then((state) => {
      if (stopped || state === null) return
      if (state.status === 'completed' || state.status === 'failed') {
        stop()
        onSettled(state)
      }
    })
  }, intervalMs)

  // Don't hold the process open on this timer.
  timer.unref?.()

  function stop(): void {
    stopped = true
    clearInterval(timer)
  }

  return stop
}

/*
 * ---------------------------------------------------------------------------
 * Wiring it into src/http/server.ts
 * ---------------------------------------------------------------------------
 *
 * Today `/api/itinerary/accept` writes `status: 'idea'` while the demo script
 * says "Booked ✓". These lines make that true. `addPlan` already returns the
 * plan, so the only change is to capture it:
 *
 *     const plan = addPlan(user.id, { ...as today..., status: 'idea' })
 *
 *     if (body.bookByPhone && activity.phone) {
 *       const taskId = await startBooking({
 *         venueName: activity.title,
 *         date: dateForDay(stay, dayIndex),
 *         time: body.time ?? '19:00',
 *         partySize: stay?.partySize ?? 2,
 *         travelerName: user.displayName,
 *       })
 *       if (taskId !== null) {
 *         watchBooking(taskId, (state) => {
 *           if (state.confirmed === true) setPlanStatus(user.id, plan.id, 'booked')
 *         })
 *       }
 *     }
 *
 *     return c.json(snapshot(user))
 *
 * The response still returns immediately; the plan flips to 'booked' when the
 * venue actually confirms, and the web client sees it on its next poll. If the
 * voice module is down, `startBooking` returns null and the plan stays an idea
 * exactly as it does today.
 */
