import fs from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { config } from '../config.js'
import { describeError, logger } from '../util/log.js'
import { localHour } from '../util/time.js'
import type { KeyedMutex } from '../util/mutex.js'
import {
  addMessage,
  addPlan,
  createBooking,
  createSession,
  createUser,
  currentStay,
  getUserBySession,
  listBookings,
  listOpenPlans,
  listPreferences,
  recentMessages,
  setPlanStatus,
  updateBooking,
  type User,
} from '../db/repo.js'
import { applyDestination, greeting, phaseFor, placeLabel } from '../onboarding/engine.js'
import { suggestFollowUps } from '../llm/suggest.js'
import { recommendationsFor, slotForHour, finishChatTurn, startChatTurn, type TimeOfDay } from '../onboarding/recommend.js'
import { activityProvider } from '../providers/index.js'
import { timezoneFor } from '../services/geocode.js'
import { extractAndApply } from '../llm/extract.js'
import { generateReply, transcriptText } from '../llm/reply.js'

const log = logger('http')

const SESSION_COOKIE = 'roadio_session'

const TIME_SLOTS: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night']

function parseSlot(value: string | undefined): TimeOfDay | undefined {
  return TIME_SLOTS.includes(value as TimeOfDay) ? (value as TimeOfDay) : undefined
}

/**
 * Sliding-window counter for the model-spending routes. In memory, which is enough for a
 * single-instance demo: a restart resets the counts along with everything else.
 */
function createRateLimiter() {
  const perIp = new Map<string, number[]>()
  const everyone: number[] = []
  const TEN_MINUTES = 10 * 60_000
  const HOUR = 60 * 60_000

  const prune = (hits: number[], windowMs: number, now: number) => {
    while (hits.length > 0 && now - hits[0]! > windowMs) hits.shift()
  }

  /** True when the request may proceed (and is counted). */
  return (ip: string): boolean => {
    const now = Date.now()
    const mine = perIp.get(ip) ?? []
    prune(mine, TEN_MINUTES, now)
    prune(everyone, HOUR, now)
    if (config.chatLimitPerIp > 0 && mine.length >= config.chatLimitPerIp) return false
    if (config.chatLimitGlobal > 0 && everyone.length >= config.chatLimitGlobal) return false
    mine.push(now)
    everyone.push(now)
    perIp.set(ip, mine)
    return true
  }
}

/** Typed context so `c.get('user')` is a User rather than unknown. */
type Env = { Variables: { user: User } }

export function createServer(mutex: KeyedMutex) {
  const app = new Hono<Env>()

  // Follow-up chips for a conversation's latest message, cached so reloads cost nothing.
  // Empty on any failure and the web app falls back to its default chips.
  const suggestionCache = new Map<string, { lastMessageId: number; suggestions: string[] }>()
  async function suggestionsFor(userId: string): Promise<string[]> {
    const latest = recentMessages(userId, 1)[0]
    if (!latest) return []

    const cached = suggestionCache.get(userId)
    if (cached?.lastMessageId === latest.id) return cached.suggestions

    const suggestions = await suggestFollowUps(userId)
    if (suggestions.length > 0) suggestionCache.set(userId, { lastMessageId: latest.id, suggestions })
    return suggestions
  }

  // --- session ---------------------------------------------------------------
  // Anonymous by construction: the first request mints a traveler so memory can
  // start accumulating before anyone is asked for anything.
  app.use('/api/*', async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE)
    let user: User | undefined = token ? getUserBySession(token) : undefined

    if (!user) {
      user = createUser()
      const fresh = createSession(user.id)
      setCookie(c, SESSION_COOKIE, fresh, {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        // No Secure flag: dev runs over plain http. Add it behind TLS.
      })
      log.info(`new traveler ${user.id}`)
    }

    c.set('user', user)
    await next()
  })

  app.onError((error, c) => {
    log.error('request failed', describeError(error))
    return c.json({ error: 'Something went wrong on our end.' }, 500)
  })

  // --- state -----------------------------------------------------------------

  app.get('/api/me', (c) => {
    const user = c.get('user')
    return c.json(snapshot(user))
  })

  // Demo convenience: drop the session so the next request mints a brand new
  // traveler. The old user row is left in place rather than deleted - cheap
  // to keep, and deleting it here would race any request already in flight.
  app.post('/api/reset', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  const allowChat = createRateLimiter()
  app.post('/api/chat', async (c) => {
    const user = c.get('user')
    // Behind a host's proxy the visitor is the first address in x-forwarded-for.
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    if (!allowChat(ip)) {
      return c.json({ error: 'The demo is getting a lot of use right now. Please try again in a few minutes.' }, 429)
    }
    const body = await c.req.json<{ message?: string }>().catch(() => ({}) as { message?: string })
    const message = body.message?.trim()
    if (!message) return c.json({ error: 'Say something first.' }, 400)
    if (message.length > 2000) return c.json({ error: 'That is a bit long for a chat message.' }, 400)

    // Serialised per traveler so two fast turns cannot interleave their writes.
    // State first (extraction), then the reply - so the answer sees the
    // destination or preference the traveler just mentioned rather than the
    // previous one.
    const reply = await mutex.run(user.id, async () => {
      const priorTranscript = transcriptText(user.id, 8)
      addMessage(user.id, 'user', message)
      startChatTurn(user.id)
      await extractAndApply(user.id, message, priorTranscript)
      const answer = await generateReply(user.id)
      const city = currentStay(user.id)?.city
      if (city) finishChatTurn(user.id, city, answer)
      addMessage(user.id, 'assistant', answer)
      return answer
    })

    // Chips ride along with the reply so the two appear together.
    const suggestions = await suggestionsFor(user.id)

    // snapshot() recomputes phase from the freshly written state.
    return c.json({ reply, suggestions, ...snapshot(user) })
  })

  // Resolves a detected location silently - it is not a conversational turn,
  // so it writes no message and generates no reply. Letting the traveler type
  // their own first message (instead of manufacturing one from the city name)
  // is the whole point of this endpoint.
  app.post('/api/location', async (c) => {
    const user = c.get('user')
    const body = await c.req.json<{
      city?: string
      country?: string | null
      countryCode?: string | null
      region?: string | null
      latitude?: number
      longitude?: number
    }>().catch(() => ({}) as Record<string, never>)

    const city = body.city?.trim()
    const { latitude, longitude } = body
    if (!city || typeof latitude !== 'number' || typeof longitude !== 'number') {
      return c.json({ error: 'city, latitude and longitude are required.' }, 400)
    }

    // The coordinates are already known (the browser's own fix, reverse-
    // geocoded client-side) - only the timezone still needs resolving. A
    // second, name-based geocode here could match an unrelated place that
    // happens to share the city's name, rather than confirming this one.
    const timezone = await timezoneFor(latitude, longitude)

    applyDestination(user.id, {
      name: city,
      latitude,
      longitude,
      timezone,
      region: body.region ?? null,
      country: body.country ?? null,
      countryCode: body.countryCode ?? null,
    })
    return c.json(snapshot(user))
  })

  app.get('/api/recommendations', async (c) => {
    const user = c.get('user')
    const stay = currentStay(user.id)
    if (!stay) return c.json({ recommendations: [], phase: 'need_destination' })

    // The picker drives this once the traveler has touched it; until then the
    // clock in their own timezone picks a sensible slot to open on.
    const slot = parseSlot(c.req.query('slot')) ?? slotForHour(localHour(stay.timezone))
    const recommendations = await recommendationsFor(user.id, slot)

    return c.json({
      recommendations,
      slot,
      phase: phaseFor(stay),
      sampleData: activityProvider().isSample,
    })
  })

  app.get('/api/suggestions', async (c) => c.json({ suggestions: await suggestionsFor(c.get('user').id) }))

  // --- activities --------------------------------------------------------------
  // No day-by-day itinerary: accepting or passing just tells the recommender
  // what's decided, so it stops resurfacing the same thing today.

  app.post('/api/activities/accept', async (c) => {
    const user = c.get('user')
    const body = await c.req.json<{ productCode?: string; timeOfDay?: string }>()
    if (!body.productCode) return c.json({ error: 'productCode is required.' }, 400)

    const activity = await activityProvider().get(body.productCode)
    if (!activity) return c.json({ error: 'That activity is no longer listed.' }, 404)

    const slot = parseSlot(body.timeOfDay)

    addPlan(user.id, {
      title: activity.title,
      detail: activity.summary,
      atTime: slot ?? null,
      provider: activity.provider,
      productCode: activity.productCode,
      priceAmount: activity.fromPrice.amount,
      currency: activity.fromPrice.currency,
      durationMinutes: activity.durationMinutes,
      status: 'idea',
    })

    return c.json({ ok: true })
  })

  app.post('/api/activities/pass', async (c) => {
    const user = c.get('user')
    const body = await c.req.json<{ productCode?: string }>()
    if (!body.productCode) return c.json({ error: 'productCode is required.' }, 400)

    const activity = await activityProvider().get(body.productCode)
    if (!activity) return c.json({ error: 'That activity is no longer listed.' }, 404)

    // Recorded rather than forgotten: invisible in the UI, but it stops the
    // recommender from surfacing the same thing again.
    addPlan(user.id, {
      title: activity.title,
      provider: activity.provider,
      productCode: activity.productCode,
      status: 'dropped',
    })

    return c.json({ ok: true })
  })

  // A recap of what's been said yes to today - not an itinerary, just a flat
  // list, since the whole point of this app is not planning multiple days.
  app.get('/api/activities', (c) => {
    const user = c.get('user')
    const picks = listOpenPlans(user.id).map((p) => ({
      id: p.id,
      title: p.title,
      detail: p.detail,
      atTime: p.atTime,
      provider: p.provider,
      productCode: p.productCode,
      priceAmount: p.priceAmount,
      currency: p.currency,
      durationMinutes: p.durationMinutes,
    }))
    return c.json({ picks })
  })

  app.post('/api/activities/:id/remove', (c) => {
    const user = c.get('user')
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isFinite(id)) return c.json({ error: 'Bad activity id.' }, 400)
    setPlanStatus(user.id, id, 'dropped')
    return c.json({ ok: true })
  })

  // --- booking --------------------------------------------------------------
  // Intentionally a domain action, not generic CRUD: callers ask Roadio to
  // book a known product, and only confirmed bookings are exposed to the UI.

  app.get('/api/bookings/confirmed', (c) => {
    const confirmed = listBookings(c.get('user').id).filter((booking) => booking.status === 'confirmed')
    return c.json({ bookings: confirmed })
  })

  app.post('/api/bookings/confirm', async (c) => {
    const user = c.get('user')
    const body: {
      productCode?: string
      dayIndex?: number
      travelDate?: string
    } = await c.req.json().catch(() => ({}))
    if (!body.productCode) return c.json({ error: 'productCode is required.' }, 400)

    const existing = listBookings(user.id).find(
      (booking) => booking.productCode === body.productCode && booking.status === 'confirmed',
    )
    if (existing) return c.json({ booking: existing, ...snapshot(user) })

    const provider = activityProvider()
    const activity = await provider.get(body.productCode)
    if (!activity) return c.json({ error: 'That activity is no longer listed.' }, 404)

    const travelDate = /^\d{4}-\d{2}-\d{2}$/.test(body.travelDate ?? '')
      ? body.travelDate!
      : new Date().toISOString().slice(0, 10)
    const stay = currentStay(user.id)
    const partySize = Math.max(stay?.partySize ?? 1, 1)

    if (provider.bookingMode === 'deeplink') {
      const bookingUrl = provider.deeplink?.(activity.productCode) ?? activity.productUrl
      const booking = createBooking({
        userId: user.id,
        provider: provider.name,
        productCode: activity.productCode,
        productTitle: activity.title,
        optionCode: null,
        optionTitle: null,
        travelDate,
        startTime: null,
        partySize,
        currency: activity.fromPrice.currency,
        totalAmount: activity.fromPrice.amount * partySize,
        status: 'deeplinked',
        holdRef: null,
        bookingRef: null,
        bookingUrl,
        cancellationPolicy: null,
        holdExpiresAt: null,
      })
      return c.json({ booking, checkoutRequired: true, ...snapshot(user) })
    }

    if (!provider.hold || !provider.book) {
      return c.json({ error: 'This provider cannot confirm bookings right now.' }, 409)
    }

    const options = await provider.availability(activity.productCode, travelDate, partySize)
    const option = options.find((candidate) => candidate.available)
    if (!option) return c.json({ error: 'No departures are available for that date.' }, 409)

    const hold = await provider.hold({
      productCode: activity.productCode,
      optionCode: option.optionCode,
      travelDate,
      partySize,
    })
    const pending = createBooking({
      userId: user.id,
      provider: provider.name,
      productCode: activity.productCode,
      productTitle: activity.title,
      optionCode: option.optionCode,
      optionTitle: option.title,
      travelDate,
      startTime: option.startTime,
      partySize,
      currency: hold.total.currency,
      totalAmount: hold.total.amount,
      status: 'held',
      holdRef: hold.holdRef,
      bookingRef: null,
      bookingUrl: null,
      cancellationPolicy: hold.cancellationPolicy,
      holdExpiresAt: hold.expiresAt,
    })

    try {
      const result = await provider.book({
        holdRef: hold.holdRef,
        productCode: activity.productCode,
        optionCode: option.optionCode,
        travelDate,
        partySize,
        traveler: {
          firstName: user.displayName?.split(/\s+/)[0] || 'Unplanned',
          lastName: user.displayName?.split(/\s+/).slice(1).join(' ') || 'Traveler',
          // The fixture provider does not contact this address. A real provider
          // must collect and validate traveler details before this step.
          email: 'booking-demo@roadio.local',
        },
      })
      const booking = updateBooking(pending.id, {
        status: result.status === 'confirmed' ? 'confirmed' : 'held',
        bookingRef: result.bookingRef,
      })!

      return c.json({ booking, ...snapshot(user) })
    } catch (error) {
      updateBooking(pending.id, { status: 'failed' })
      throw error
    }
  })

  app.post('/api/bookings/:id/cancel', (c) => {
    const user = c.get('user')
    const booking = listBookings(user.id).find((candidate) => candidate.id === c.req.param('id'))
    if (!booking) return c.json({ error: 'Booking not found.' }, 404)
    if (booking.status !== 'confirmed') {
      return c.json({ error: 'Only confirmed bookings can be cancelled here.' }, 409)
    }

    const provider = activityProvider()
    // The fixture provider has no external system to notify. A real supplier
    // must implement an explicit cancellation operation before this route is
    // allowed to change its booking locally.
    if (!provider.isSample || booking.provider !== provider.name) {
      return c.json({ error: 'This booking must be cancelled with the provider.' }, 409)
    }

    const cancelled = updateBooking(booking.id, { status: 'cancelled' })!
    return c.json({ booking: cancelled, ...snapshot(user) })
  })

  // --- static ----------------------------------------------------------------
  // In dev, Vite serves the SPA and proxies /api here, so this only matters for
  // a built frontend.
  if (fs.existsSync(config.webDir)) {
    app.use('/*', serveStatic({ root: path.relative(process.cwd(), config.webDir) || '.' }))
    app.get('/*', (c) => {
      const index = path.join(config.webDir, 'index.html')
      if (!fs.existsSync(index)) return c.text('Frontend not built. Run `npm run web:build`.', 404)
      return c.html(fs.readFileSync(index, 'utf8'))
    })
  }

  return app
}

/** Everything the frontend needs to render, in one payload. */
function snapshot(user: User) {
  const stay = currentStay(user.id)

  return {
    user: { id: user.id, linked: Boolean(user.telegramChatId) },
    phase: phaseFor(stay),
    greeting: greeting(),
    trip: stay
      ? {
          city: stay.city,
          country: stay.country,
          label: placeLabel(stay.city, stay.country),
          timezone: stay.timezone,
          budgetLevel: stay.budgetLevel,
          partySize: stay.partySize,
        }
      : null,
    preferences: listPreferences(user.id).map((p) => ({ id: p.id, kind: p.kind, text: p.text })),
    messages: recentMessages(user.id, 50).map((m) => ({
      role: m.role,
      text: m.text,
      at: m.createdAt,
    })),
  }
}

export function startServer(mutex: KeyedMutex): () => void {
  const app = createServer(mutex)
  const server = serve({ fetch: app.fetch, port: config.httpPort })
  log.info(`listening on http://localhost:${config.httpPort}`)
  return () => server.close()
}
