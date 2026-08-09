/**
 * Smoke test for everything that doesn't need Anthropic credentials: migrations,
 * the trip-state write path, live geocoding and weather, the proactive gates,
 * and per-traveler serialisation.
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

const { runMigrations } = await import('../src/db/index.js')
const {
  addMessage,
  addNudge,
  addPlan,
  addPreference,
  currentStay,
  getOrCreateUser,
  listOpenPlans,
  listPreferences,
  nudgeCountToday,
  setStayGeo,
  updateUser,
  upsertCurrentStay,
} = await import('../src/db/repo.js')
const { renderTravelerState } = await import('../src/llm/state.js')
const { skipReason } = await import('../src/proactive/nudge.js')
const { geocode } = await import('../src/services/geocode.js')
const { formatForecast, getForecast } = await import('../src/services/weather.js')
const { weatherTool, webSearchTool } = await import('../src/tools/index.js')
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

  const userId = 'smoke-user'
  const user = getOrCreateUser(userId, 'Smoke')
  check('user created with defaults', user.maxNudgesPerDay === 3 && !user.paused)

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

  section('stay lifecycle')
  const first = upsertCurrentStay(userId, {
    city: 'Lima',
    country: 'Peru',
    lodgingArea: 'Miraflores',
    departureDate: '2026-08-16',
  })
  check('stay opened and current', first.city === 'Lima' && first.isCurrent)

  if (geo) {
    setStayGeo(first.id, {
      latitude: geo.latitude,
      longitude: geo.longitude,
      timezone: geo.timezone,
      region: geo.region,
      country: 'Peru',
      countryCode: geo.countryCode,
    })
  }

  // The extractor reports only what the newest message mentioned, so a partial
  // update must never blank out a field we already know.
  upsertCurrentStay(userId, { city: 'Lima', lodgingName: 'Hostel Kaminu' })
  const merged = currentStay(userId)!
  check('partial update keeps lodging area', merged.lodgingArea === 'Miraflores')
  check('partial update keeps departure date', merged.departureDate === '2026-08-16')
  check('partial update applies new field', merged.lodgingName === 'Hostel Kaminu')
  check('partial update keeps coordinates', merged.latitude !== null)

  const cusco = upsertCurrentStay(userId, { city: 'Cusco', country: 'Peru' })
  check('new city opens a new stay', cusco.id !== merged.id)
  check('only the newest stay is current', currentStay(userId)!.id === cusco.id)

  const back = upsertCurrentStay(userId, { city: 'Lima', country: 'Peru' })
  if (geo) {
    setStayGeo(back.id, {
      latitude: geo.latitude,
      longitude: geo.longitude,
      timezone: geo.timezone,
      region: geo.region,
      country: 'Peru',
      countryCode: geo.countryCode,
    })
  }

  section('plans and preferences')
  addPlan(userId, { title: 'Food tour in Barranco', onDate: '2026-08-12' })
  addPreference(userId, 'dislike', 'crowded tourist traps')
  addPreference(userId, 'dislike', 'Crowded Tourist Traps')
  check('plan recorded', listOpenPlans(userId).length === 1)
  check('preferences deduped case-insensitively', listPreferences(userId).length === 1)

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

  const search = webSearchTool(currentStay(userId)) as {
    definition: { user_location?: { country?: string; timezone?: string } }
  }
  check('search country is ISO alpha-2', search.definition.user_location?.country === 'PE')
  check('search timezone is IANA', search.definition.user_location?.timezone === 'America/Lima')

  section('proactive gates')
  addMessage(userId, 'user', 'landed in Lima, staying in Miraflores till Sunday')
  updateUser(userId, { quietStartHour: 0, quietEndHour: 0 })
  check('eligible when nothing blocks', skipReason(getOrCreateUser(userId)) === null)

  updateUser(userId, { paused: true })
  check('pause blocks', skipReason(getOrCreateUser(userId)) === 'paused')
  updateUser(userId, { paused: false, maxNudgesPerDay: 1 })

  addNudge(userId, 'sunset-walk', 'Rain clears at 4, walk the Malecon.')
  check('daily cap blocks', skipReason(getOrCreateUser(userId))?.includes('daily cap') === true)
  check('nudge counted against local day', nudgeCountToday(userId, 'America/Lima') === 1)

  updateUser(userId, { maxNudgesPerDay: 5 })
  check('minimum gap blocks', skipReason(getOrCreateUser(userId))?.includes('too soon') === true)

  updateUser(userId, { minNudgeGapMinutes: 0, quietStartHour: 0, quietEndHour: 23 })
  check('quiet hours block', skipReason(getOrCreateUser(userId))?.includes('quiet hours') === true)

  check('unknown location blocks', skipReason(getOrCreateUser('smoke-user-2')) === 'location unknown')

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

  await mutex.run('u', async () => {
    throw new Error('deliberate')
  }).catch(() => undefined)
  check('chain survives a rejection', (await mutex.run('u', async () => 'ok')) === 'ok')

  section('conversation window')
  const { conversationMessages } = await import('../src/llm/reply.js')
  // A proactive nudge adds an unpaired assistant turn; if the window is later
  // truncated onto it, the API rejects the request. The window must be trimmed
  // to start on a user turn.
  const windowUser = 'smoke-window'
  getOrCreateUser(windowUser)
  addMessage(windowUser, 'assistant', 'unprompted suggestion', true)
  addMessage(windowUser, 'assistant', 'a second one', true)
  addMessage(windowUser, 'user', 'thanks')
  const trimmed = conversationMessages(windowUser, 16)
  check('window starts on a user turn', trimmed[0]?.role === 'user', trimmed.map((m) => m.role))

  const noUserTurns = 'smoke-window-2'
  getOrCreateUser(noUserTurns)
  addMessage(noUserTurns, 'assistant', 'only ever spoke first', true)
  check('window is empty when no user turn exists', conversationMessages(noUserTurns).length === 0)

  section('rendered state')
  const state = renderTravelerState(userId)
  check('names the city', /CURRENT LOCATION: Lima/.test(state))
  check('lists open plans', /Food tour in Barranco/.test(state))
  check('lists prior suggestions', /sunset-walk/.test(state))
  check('includes local time', /Local date and time/.test(state))

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
  fs.rmSync(scratch, { recursive: true, force: true })
  process.exit(failures === 0 ? 0 : 1)
}

await main()
