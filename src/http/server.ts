import fs from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { config } from '../config.js'
import { describeError, logger } from '../util/log.js'
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
import { greeting, handleTurn, phaseFor, placeLabel } from '../onboarding/engine.js'
import { recommendationsFor } from '../onboarding/recommend.js'
import { activityProvider } from '../providers/index.js'
import { bookingState, startBooking } from '../concierge/client.js'

const log = logger('http')

const SESSION_COOKIE = 'roadio_session'

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

  app.get('/api/recommendations', async (c) => {
    const user = c.get('user')
    const stay = currentStay(user.id)
    if (!stay) return c.json({ recommendations: [], phase: 'need_destination' })

    const recommendations = await recommendationsFor(user.id)
    return c.json({
      recommendations,
      phase: phaseFor(stay),
      sampleData: activityProvider().isSample,
    })
  })

  // --- itinerary -------------------------------------------------------------

  app.post('/api/itinerary/accept', async (c) => {
    const user = c.get('user')
    const body = await c.req.json<{
      productCode?: string
      dayIndex?: number
    }>()

    if (!body.productCode) return c.json({ error: 'productCode is required.' }, 400)

    const activity = await activityProvider().get(body.productCode)
    if (!activity) return c.json({ error: 'That activity is no longer listed.' }, 404)

    const stay = currentStay(user.id)
    const days = Math.max(stay?.nights ?? 3, 1)
    const dayIndex = clamp(body.dayIndex ?? 1, 1, days)

    addPlan(user.id, {
      title: activity.title,
      detail: activity.summary,
      dayIndex,
      provider: activity.provider,
      productCode: activity.productCode,
      priceAmount: activity.fromPrice.amount,
      currency: activity.fromPrice.currency,
      durationMinutes: activity.durationMinutes,
      status: 'idea',
    })

    return c.json(snapshot(user))
  })

  app.post('/api/itinerary/pass', async (c) => {
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

    return c.json(snapshot(user))
  })

  app.post('/api/itinerary/:id/remove', (c) => {
    const user = c.get('user')
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isFinite(id)) return c.json({ error: 'Bad itinerary id.' }, 400)
    setPlanStatus(user.id, id, 'dropped')
    return c.json(snapshot(user))
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
    const body: { productCode?: string; dayIndex?: number } = await c.req.json().catch(() => ({}))
    if (!body.productCode) return c.json({ error: 'productCode is required.' }, 400)

    const activity = await activityProvider().get(body.productCode)
    if (!activity) return c.json({ error: 'That activity is no longer listed.' }, 404)

    const stay = currentStay(user.id)
    const dayIndex = Math.max(body.dayIndex ?? 1, 1)
    const baseDate = stay?.arrivalDate && /^\d{4}-\d{2}-\d{2}$/.test(stay.arrivalDate)
      ? stay.arrivalDate
      : new Date().toISOString().slice(0, 10)
    const travelDate = new Date(Date.parse(`${baseDate}T12:00:00Z`) + (dayIndex - 1) * 86_400_000)
      .toISOString().slice(0, 10)

    const taskId = await startBooking({
      venueName: activity.title,
      venueKind: 'tour',
      venueAddress: activity.meetingPoint?.address,
      date: travelDate,
      time: '18:00',
      partySize: Math.max(stay?.partySize ?? 1, 1),
      travelerName: user.displayName,
      notes: 'Please ask about availability and how to complete the booking.',
    })

    if (!taskId) return c.json({ error: 'The calling service is unavailable right now.' }, 503)
    return c.json({ taskId, status: 'dialing' })
  })

  app.get('/api/bookings/call/:taskId', async (c) => {
    const state = await bookingState(c.req.param('taskId'))
    if (!state) return c.json({ error: 'The call status is unavailable.' }, 503)
    return c.json(state)
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
          firstName: user.displayName?.split(/\s+/)[0] || 'Roadio',
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
  const plans = listOpenPlans(user.id)
  const days = Math.max(stay?.nights ?? 0, 0)

  return {
    user: { id: user.id, linked: Boolean(user.telegramChatId) },
    phase: phaseFor(stay),
    greeting: greeting(),
    trip: stay
      ? {
          city: stay.city,
          country: stay.country,
          label: placeLabel(stay.city, stay.country),
          days: stay.nights,
          timezone: stay.timezone,
          budgetLevel: stay.budgetLevel,
          partySize: stay.partySize,
        }
      : null,
    itinerary: buildItinerary(plans, days),
    preferences: listPreferences(user.id).map((p) => ({ id: p.id, kind: p.kind, text: p.text })),
    messages: recentMessages(user.id, 50).map((m) => ({
      role: m.role,
      text: m.text,
      at: m.createdAt,
    })),
  }
}

/** Group accepted items into day buckets - the structured flow map. */
function buildItinerary(plans: ReturnType<typeof listOpenPlans>, days: number) {
  const dayCount = days > 0 ? days : Math.max(...plans.map((p) => p.dayIndex ?? 1), 1)

  const buckets = Array.from({ length: dayCount }, (_, index) => ({
    day: index + 1,
    items: [] as Array<{
      id: number
      title: string
      detail: string | null
      durationMinutes: number | null
      priceAmount: number | null
      currency: string | null
      productCode: string | null
    }>,
  }))

  for (const plan of plans) {
    const day = clamp(plan.dayIndex ?? 1, 1, dayCount)
    buckets[day - 1]!.items.push({
      id: plan.id,
      title: plan.title,
      detail: plan.detail,
      durationMinutes: plan.durationMinutes,
      priceAmount: plan.priceAmount,
      currency: plan.currency,
      productCode: plan.productCode,
    })
  }

  return buckets
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function startServer(mutex: KeyedMutex): () => void {
  const app = createServer(mutex)
  const server = serve({ fetch: app.fetch, port: config.httpPort })
  log.info(`listening on http://localhost:${config.httpPort}`)
  return () => server.close()
}
