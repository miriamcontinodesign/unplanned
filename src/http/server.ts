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
  addPlan,
  createBooking,
  createLinkCode,
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
import { applyDestination, greeting, handleTurn, phaseFor, placeLabel } from '../onboarding/engine.js'
import { recommendationsFor, slotForHour, type TimeOfDay } from '../onboarding/recommend.js'
import { activityProvider } from '../providers/index.js'
import { conciergeTaskUrl, createBookingTask } from '../concierge/client.js'
import { timezoneFor } from '../services/geocode.js'

const log = logger('http')

const SESSION_COOKIE = 'roadio_session'

const TIME_SLOTS: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night']

function parseSlot(value: string | undefined): TimeOfDay | undefined {
  return TIME_SLOTS.includes(value as TimeOfDay) ? (value as TimeOfDay) : undefined
}

/** Roughly when each slot happens, for the concierge call script. */
const SLOT_TIMES: Record<TimeOfDay, string> = {
  morning: '09:30',
  afternoon: '14:00',
  evening: '18:30',
  night: '21:00',
}

/** Typed context so `c.get('user')` is a User rather than unknown. */
type Env = { Variables: { user: User } }

export function createServer(mutex: KeyedMutex) {
  const app = new Hono<Env>()

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

  app.post('/api/chat', async (c) => {
    const user = c.get('user')
    const body = await c.req.json<{ message?: string }>().catch(() => ({}) as { message?: string })
    const message = body.message?.trim()
    if (!message) return c.json({ error: 'Say something first.' }, 400)
    if (message.length > 2000) return c.json({ error: 'That is a bit long for a chat message.' }, 400)

    // Serialised per traveler so two fast turns cannot interleave their writes.
    const result = await mutex.run(user.id, () => handleTurn(user.id, message))

    // snapshot() recomputes phase from the freshly written state.
    return c.json({ reply: result.reply, ...snapshot(user) })
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

  app.post('/api/bookings/call', async (c) => {
    const user = c.get('user')
    const body: { productCode?: string; timeOfDay?: string } = await c.req.json().catch(() => ({}))
    if (!body.productCode) return c.json({ error: 'productCode is required.' }, 400)

    const activity = await activityProvider().get(body.productCode)
    if (!activity) return c.json({ error: 'That activity is no longer listed.' }, 404)

    // No day-by-day itinerary here - this app is about today. The call asks
    // about right now, at roughly whichever part of the day was picked.
    const stay = currentStay(user.id)
    const slot = parseSlot(body.timeOfDay) ?? (stay ? slotForHour(localHour(stay.timezone)) : 'evening')
    const travelDate = new Date().toISOString().slice(0, 10)

    const taskId = await createBookingTask({
      venueName: activity.title,
      venueKind: 'tour',
      venueAddress: activity.meetingPoint?.address,
      date: travelDate,
      time: SLOT_TIMES[slot],
      partySize: Math.max(stay?.partySize ?? 1, 1),
      travelerName: user.displayName,
      notes: 'Please ask about availability and how to complete the booking.',
    })

    if (!taskId) return c.json({ error: 'The calling service is unavailable right now.' }, 503)
    return c.json({ taskId, status: 'queued', dashboardUrl: conciergeTaskUrl(taskId) })
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

  // --- telegram link ---------------------------------------------------------

  app.post('/api/link/code', (c) => {
    const user = c.get('user')
    const { code, expiresAt } = createLinkCode(user.id)
    return c.json({ code, expiresAt })
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
