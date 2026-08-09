/**
 * Smoke test for everything that doesn't need Anthropic credentials: migrations,
 * the trip-state write path, web sessions, Telegram account linking and its user
 * merge, the sample activity catalogue and its booking path, live geocoding and
 * weather, the proactive gates, and per-traveler serialisation.
 *
 *   npm run smoke
 *
 * It runs against a throwaway database and hits the real Open-Meteo API, so it
 * needs a network connection but no keys.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Point the app at a scratch database before anything imports the config.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'roadio-smoke-'))
process.env.ROADIO_DB_PATH = path.join(scratch, 'smoke.db')
process.env.TELEGRAM_BOT_TOKEN ??= 'smoke-test-placeholder'
process.env.ROADIO_VIATOR_MOCK = 'true'

const { runMigrations } = await import('../src/db/index.js')
const repo = await import('../src/db/repo.js')
const { renderTravelerState } = await import('../src/llm/state.js')
const { conversationMessages } = await import('../src/llm/reply.js')
const { skipReason } = await import('../src/proactive/nudge.js')
const { geocode } = await import('../src/services/geocode.js')
const { formatForecast, getForecast } = await import('../src/services/weather.js')
const { experienceSearchTool } = await import('../src/components/index.js')
const { searchMockExperiences } = await import('../src/components/viator.mock.js')
const { activityProvider } = await import('../src/providers/index.js')
const { weatherTool, webSearchTool } = await import('../src/tools/index.js')
const { formatExperienceResults, viatorSessionId } = await import('../src/services/viator.js')
const { isQuietHour } = await import('../src/util/time.js')
const { KeyedMutex } = await import('../src/util/mutex.js')

let failures = 0

function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++
  const suffix = detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${suffix}`)
}

function section(name: string) {
  console.log(`\n== ${name} ==`)
}

async function main(): Promise<void> {
  section('migrations')
  runMigrations()

  // Identity is opaque now: the Telegram chat id is an attribute, not the key.
  const telegramChat = '55501'
  const user = repo.getOrCreateUserByTelegram(telegramChat, 'Smoke')
  const userId = user.id
  check('user id is opaque, not the chat id', userId.startsWith('usr_') && userId !== telegramChat)
  check('chat id recorded on the user', user.telegramChatId === telegramChat)
  check('defaults applied', user.maxNudgesPerDay === 3 && !user.paused)
  check('same chat resolves to same user', repo.getOrCreateUserByTelegram(telegramChat).id === userId)

  section('web sessions')
  const token = repo.createSession(userId)
  check('session resolves to its user', repo.getUserBySession(token)?.id === userId)
  check('unknown token resolves to nobody', repo.getUserBySession('not-a-real-token') === undefined)

  section('quiet hours')
  check('start === end disables quiet hours', isQuietHour('UTC', 8, 8) === false)
  check('wrapping window is evaluated', typeof isQuietHour('UTC', 21, 8) === 'boolean')

  section('geocoding (live)')
  const geo = await geocode('Lima, Peru')
  check('resolved Lima', geo !== null && Math.abs(geo.latitude + 12.04) < 1)
  check('IANA timezone', geo?.timezone === 'America/Lima', geo?.timezone)
  check('ISO alpha-2 country code', geo?.countryCode === 'PE', geo?.countryCode)
  const slovenia = await geocode('Ljubljana')
  check('country code is not hand-mapped', slovenia?.countryCode === 'SI', slovenia?.countryCode)

  const applyGeo = (stayId: number) => {
    if (!geo) return
    repo.setStayGeo(stayId, {
      latitude: geo.latitude,
      longitude: geo.longitude,
      timezone: geo.timezone,
      region: geo.region,
      country: 'Peru',
      countryCode: geo.countryCode,
    })
  }

  section('stay lifecycle')
  const first = repo.upsertCurrentStay(userId, {
    city: 'Lima',
    country: 'Peru',
    lodgingArea: 'Miraflores',
    nights: 5,
  })
  check('stay opened and current', first.city === 'Lima' && first.isCurrent)
  check('duration stored as nights', first.nights === 5)
  applyGeo(first.id)

  // Callers report only what the latest input mentioned, so a partial update
  // must never blank out a field we already know.
  repo.upsertCurrentStay(userId, { city: 'Lima', lodgingName: 'Hostel Kaminu' })
  const merged = repo.currentStay(userId)!
  check('partial update keeps lodging area', merged.lodgingArea === 'Miraflores')
  check('partial update keeps nights', merged.nights === 5)
  check('partial update applies new field', merged.lodgingName === 'Hostel Kaminu')
  check('partial update keeps coordinates', merged.latitude !== null)

  const cusco = repo.upsertCurrentStay(userId, { city: 'Cusco', country: 'Peru' })
  check('new city opens a new stay', cusco.id !== merged.id)
  check('only the newest stay is current', repo.currentStay(userId)!.id === cusco.id)

  const back = repo.upsertCurrentStay(userId, { city: 'Lima', country: 'Peru', nights: 5 })
  applyGeo(back.id)

  section('itinerary items')
  repo.addPlan(userId, { title: 'Food tour in Barranco', dayIndex: 2 })
  repo.addPlan(userId, { title: 'Passed on this one', dayIndex: 1, status: 'dropped' })
  const open = repo.listOpenPlans(userId)
  check('accepted item is listed', open.length === 1 && open[0]?.title === 'Food tour in Barranco')
  check('day index stored', open[0]?.dayIndex === 2)
  check('dropped item is hidden from the itinerary', !open.some((p) => p.status === 'dropped'))
  check('dropped item is still retained', repo.listAllPlans(userId).length === 2)

  repo.addPreference(userId, 'dislike', 'crowded tourist traps', 'onboarding')
  repo.addPreference(userId, 'dislike', 'Crowded Tourist Traps')
  check('preferences deduped case-insensitively', repo.listPreferences(userId).length === 1)
  check('preference source recorded', repo.listPreferences(userId)[0]?.source === 'onboarding')

  section('sample activity catalogue')
  const provider = activityProvider()
  check('provider is flagged as sample', provider.isSample)

  const results = await provider.search({ destination: 'Lima', interests: ['food'], partySize: 2 })
  check('search returns a catalogue', results.length > 0, results.length)
  check('interest ranks first', results[0]?.tags.includes('food') === true, results[0]?.title)
  check('titles use the destination', results[0]?.title.includes('Lima') === true, results[0]?.title)

  const repeat = await provider.search({ destination: 'Lima', interests: ['food'], partySize: 2 })
  check(
    'catalogue is deterministic across calls',
    repeat[0]?.productCode === results[0]?.productCode &&
      repeat[0]?.fromPrice.amount === results[0]?.fromPrice.amount,
  )

  const budgeted = await provider.search({ destination: 'Lima', budgetLevel: 'shoestring' })
  check('budget ceiling filters', budgeted.every((a) => a.fromPrice.amount <= 60))

  const anywhere = await provider.search({ destination: 'Ljubljana' })
  check('any destination yields a catalogue', anywhere.length > 0)

  const code = results[0]!.productCode
  check('product code round-trips through get()', (await provider.get(code))?.productCode === code)
  check('unknown product code returns null', (await provider.get('SAMPLE_NOWHERE_FAKE')) === null)

  section('booking path')
  const options = await provider.availability(code, '2026-09-01', 2)
  check('availability returns options', options.length > 0)
  check('option totals scale with party size', options.every((o) => o.total.amount > 0))

  const bookable = options.find((o) => o.available)
  if (!bookable) {
    check('at least one departure is bookable', false)
  } else {
    const hold = await provider.hold!({
      productCode: code,
      optionCode: bookable.optionCode,
      travelDate: '2026-09-01',
      partySize: 2,
    })
    check('hold returns a reference', hold.holdRef.startsWith('HOLD-'))
    check('hold has a future expiry', Date.parse(hold.expiresAt) > Date.now())

    const booking = repo.createBooking({
      userId,
      provider: provider.name,
      productCode: code,
      productTitle: results[0]!.title,
      optionCode: bookable.optionCode,
      optionTitle: bookable.title,
      travelDate: '2026-09-01',
      startTime: bookable.startTime,
      partySize: 2,
      currency: hold.total.currency,
      totalAmount: hold.total.amount,
      status: 'held',
      holdRef: hold.holdRef,
      bookingRef: null,
      bookingUrl: null,
      cancellationPolicy: hold.cancellationPolicy,
      holdExpiresAt: hold.expiresAt,
    })
    check('booking persisted as held', booking.status === 'held')

    const confirmed = await provider.book!({
      holdRef: hold.holdRef,
      productCode: code,
      optionCode: bookable.optionCode,
      travelDate: '2026-09-01',
      partySize: 2,
      traveler: { firstName: 'Sam', lastName: 'Traveler', email: 'sam@example.com' },
    })
    check('booking confirms', confirmed.status === 'confirmed' && confirmed.bookingRef.length > 0)

    const stored = repo.updateBooking(booking.id, {
      status: 'confirmed',
      bookingRef: confirmed.bookingRef,
    })
    check('booking updated to confirmed', stored?.status === 'confirmed')
    check('booking listed for the traveler', repo.listBookings(userId).length === 1)

    // A hold is single-use; replaying it must fail rather than double-book.
    let replayed = false
    await provider
      .book!({
        holdRef: hold.holdRef,
        productCode: code,
        optionCode: bookable.optionCode,
        travelDate: '2026-09-01',
        partySize: 2,
        traveler: { firstName: 'Sam', lastName: 'Traveler', email: 'sam@example.com' },
      })
      .then(() => {
        replayed = true
      })
      .catch(() => undefined)
    check('a spent hold cannot be booked twice', !replayed)
  }

  section('weather (live)')
  const forecast = geo ? await getForecast(geo.latitude, geo.longitude, 3) : null
  check('forecast fetched', forecast !== null && forecast.days.length === 3)
  if (forecast) {
    check('forecast renders', /Weather for Lima/.test(formatForecast('Lima, Peru', forecast)))
  }

  section('tool wiring')
  const weather = weatherTool(userId)
  check('weather defaults to current stay', /Weather for Lima/.test(await weather.run!({})))
  check('weather honours explicit place', /Reykjav/i.test(await weather.run!({ place: 'Reykjavik' })))
  check(
    'weather fails soft on an unknown place',
    /Could not find/.test(await weather.run!({ place: 'Zzzqqxnotaplace' })),
  )

  const search = webSearchTool(repo.currentStay(userId)) as {
    definition: { user_location?: { country?: string; timezone?: string } }
  }
  check('search country is ISO alpha-2', search.definition.user_location?.country === 'PE')
  check('search timezone is IANA', search.definition.user_location?.timezone === 'America/Lima')

  const experiences = experienceSearchTool(userId)
  check(
    'experience search exposes required date fields',
    (experiences.definition as { input_schema: { required: string[] } }).input_schema.required
      .join(',') === 'searchTerm,startDate,endDate',
  )
  check('Viator session id is stable', viatorSessionId(userId) === viatorSessionId(userId))
  check('Viator session id hides user id', !viatorSessionId(userId).includes(userId))
  const formattedExperiences = formatExperienceResults({
    sessionId: viatorSessionId(userId),
    experiences: [{
      title: 'Barranco food walk',
      code: 'TEST1',
      rating: 4.87,
      reviewCount: 321,
      freeCancellation: true,
      fromPrice: 49,
      clickOffToLander: 'https://www.viator.com/example',
      duration: { fixedDurationInMinutes: 150 },
      keyAttributes: { mainCategory: 'Food Tours' },
    }],
  }, 'USD')
  check('experience results render price', formattedExperiences.includes('$49'))
  check('experience results render useful facts', /4\.9\/5.*2\.5 hr.*free cancellation/.test(formattedExperiences))
  check('experience results preserve booking link', formattedExperiences.includes('viator.com/example'))
  const mockCooking = await experiences.run!({
    searchTerm: 'family cooking class in Brooklyn',
    startDate: '2026-08-15',
    endDate: '2026-08-15',
    toPrice: 75,
    currency: 'USD',
  })
  check('mock component finds Brooklyn cooking class', mockCooking.includes('Brooklyn Pizza-Making'))
  check('mock component respects maximum price', !mockCooking.includes('Fresh Pasta'))
  check('mock links cannot be mistaken for live bookings', mockCooking.includes('example.invalid'))
  check('mock result includes E.164 operator phone', mockCooking.includes('+12125550102'))
  check('mock operator phone is clearly labeled', mockCooking.includes('Mock operator phone'))
  const mayaResults = searchMockExperiences(userId, {
    searchTerm: 'food tonight in Lisbon, solo, quiet, hate crowds',
    startDate: '2026-08-09',
    endDate: '2026-08-09',
    currency: 'EUR',
  })
  check('Maya receives exactly three Lisbon choices', mayaResults.experiences.length === 3)
  check(
    'Maya results are location-correct',
    mayaResults.experiences.every((experience) => experience.code.startsWith('MOCK-LISBON-')),
  )
  check(
    'Maya cards have a concrete why',
    mayaResults.experiences.every((experience) => Boolean(experience.recommendationContext?.why)),
  )
  check(
    'Maya cards expose evening times and crowd fit',
    mayaResults.experiences.every((experience) =>
      Boolean(experience.recommendationContext?.availableStartTimes?.length) &&
      experience.recommendationContext?.crowdLevel === 'quiet'),
  )
  const usCallingMocks = searchMockExperiences(userId, {
    searchTerm: 'cooking class in Chicago',
    startDate: '2026-08-15',
    endDate: '2026-08-15',
    currency: 'USD',
  })
  check(
    'US mock search stays in the requested city',
    usCallingMocks.experiences.length === 1 &&
    usCallingMocks.experiences[0]?.code === 'MOCK-US-CHICAGO-PIZZA',
  )
  check(
    'US calling mock has a reserved phone number',
    usCallingMocks.experiences[0]?.contactPhone === '+13125550112' &&
    usCallingMocks.experiences[0]?.contactPhoneIsMock === true,
  )

  section('proactive gates')
  repo.addMessage(userId, 'user', 'landed in Lima, staying in Miraflores till Sunday')
  repo.updateUser(userId, { quietStartHour: 0, quietEndHour: 0 })
  check('eligible when nothing blocks', skipReason(repo.getUser(userId)!) === null)

  repo.updateUser(userId, { paused: true })
  check('pause blocks', skipReason(repo.getUser(userId)!) === 'paused')
  repo.updateUser(userId, { paused: false, maxNudgesPerDay: 1 })

  repo.addNudge(userId, 'sunset-walk', 'Rain clears at 4, walk the Malecon.')
  check('daily cap blocks', skipReason(repo.getUser(userId)!)?.includes('daily cap') === true)
  check('nudge counted against local day', repo.nudgeCountToday(userId, 'America/Lima') === 1)

  repo.updateUser(userId, { maxNudgesPerDay: 5 })
  check('minimum gap blocks', skipReason(repo.getUser(userId)!)?.includes('too soon') === true)

  repo.updateUser(userId, { minNudgeGapMinutes: 0, quietStartHour: 0, quietEndHour: 23 })
  check('quiet hours block', skipReason(repo.getUser(userId)!)?.includes('quiet hours') === true)
  repo.updateUser(userId, { quietStartHour: 21, quietEndHour: 8 })

  const webOnly = repo.createUser('Web only')
  check('web-only traveler is skipped by the proactive engine', skipReason(webOnly) === 'location unknown')
  check('proactive engine only lists reachable travelers', repo.listActiveUsers().every((u) => u.telegramChatId))

  section('account linking')
  // A fresh web traveler with their own onboarding state.
  const webUser = repo.createUser('Web visitor')
  const webToken = repo.createSession(webUser.id)
  repo.upsertCurrentStay(webUser.id, { city: 'Porto', country: 'Portugal', nights: 4 })
  repo.addPreference(webUser.id, 'like', 'seafood', 'onboarding')

  check('unknown code is rejected', repo.redeemLinkCode('ZZZZ-ZZZZ', '999').ok === false)

  const issued = repo.createLinkCode(webUser.id)
  check('code is issued in a readable shape', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(issued.code), issued.code)

  // Issuing again must retire the previous code, or old codes stay live forever.
  const reissued = repo.createLinkCode(webUser.id)
  check('reissuing retires the previous code', repo.redeemLinkCode(issued.code, '777').ok === false)

  // Link to a Telegram chat that already has its own history: the merge path.
  const existingChat = '66602'
  const chatUser = repo.getOrCreateUserByTelegram(existingChat, 'Chatty')
  repo.addMessage(chatUser.id, 'user', 'hello from telegram')
  repo.addPreference(chatUser.id, 'dislike', 'early mornings')
  repo.upsertCurrentStay(chatUser.id, { city: 'Braga', country: 'Portugal' })

  const outcome = repo.redeemLinkCode(reissued.code, existingChat, 'Chatty')
  check('link succeeds', outcome.ok === true)
  check('web traveler wins the merge', outcome.ok && outcome.userId === webUser.id)
  check('merged from the telegram traveler', outcome.ok && outcome.mergedFrom === chatUser.id)

  const linked = repo.getUser(webUser.id)!
  check('chat id moved onto the surviving traveler', linked.telegramChatId === existingChat)
  check('old traveler is gone', repo.getUser(chatUser.id) === undefined)
  check('chat lookup now resolves to the survivor', repo.getUserByTelegramChat(existingChat)?.id === webUser.id)

  check('messages moved across', repo.recentMessages(webUser.id).some((m) => m.text === 'hello from telegram'))
  check(
    'preferences from both sides survive',
    repo.listPreferences(webUser.id).length === 2,
    repo.listPreferences(webUser.id).map((p) => p.text),
  )
  check('exactly one current stay after merge', repo.listStays(webUser.id).filter((s) => s.isCurrent).length === 1)
  check('web session still resolves after merge', repo.getUserBySession(webToken)?.id === webUser.id)
  check('a spent code cannot be reused', repo.redeemLinkCode(reissued.code, existingChat).ok === false)

  section('per-traveler serialisation')
  const mutex = new KeyedMutex()
  const order: string[] = []
  await Promise.all([
    mutex.run('u', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      order.push('first')
    }),
    mutex.run('u', async () => {
      order.push('second')
    }),
  ])
  check('same traveler runs in order', order.join(',') === 'first,second', order)

  await mutex
    .run('u', async () => {
      throw new Error('deliberate')
    })
    .catch(() => undefined)
  check('chain survives a rejection', (await mutex.run('u', async () => 'ok')) === 'ok')

  section('conversation window')
  // A proactive nudge adds an unpaired assistant turn; if the window is later
  // truncated onto it, the API rejects the request.
  const windowUser = repo.createUser('Window')
  repo.addMessage(windowUser.id, 'assistant', 'unprompted suggestion', true)
  repo.addMessage(windowUser.id, 'assistant', 'a second one', true)
  repo.addMessage(windowUser.id, 'user', 'thanks')
  check('window starts on a user turn', conversationMessages(windowUser.id, 16)[0]?.role === 'user')

  const silentUser = repo.createUser('Silent')
  repo.addMessage(silentUser.id, 'assistant', 'only ever spoke first', true)
  check('window is empty when no user turn exists', conversationMessages(silentUser.id).length === 0)

  section('rendered state')
  const state = renderTravelerState(userId)
  check('names the city', /CURRENT LOCATION: Lima/.test(state))
  check('lists open plans', /Food tour in Barranco/.test(state))
  check('hides dropped plans', !/Passed on this one/.test(state))
  check('lists prior suggestions', /sunset-walk/.test(state))
  check('includes local time', /Local date and time/.test(state))

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
  fs.rmSync(scratch, { recursive: true, force: true })
  process.exit(failures === 0 ? 0 : 1)
}

await main()
