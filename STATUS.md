# Status

Last updated: 2026-08-09.

`main` compiles, builds, and passes 82 smoke checks. The Telegram concierge works.
The web app is not started.

## MVP target

A chat-based onboarding that captures **where** and **how many days**, leads to a
**recommended set of activities**, and feeds a **structured day-by-day itinerary
map** built from what the traveler accepted or passed on. Bookings are a later
stage. No third-party integrations.

## Where things stand

| MVP piece | State |
|---|---|
| Trip memory: destination, days, preferences | **Done and tested** |
| Web identity: sessions, Telegram linking, user merge | **Done and tested** |
| Activity catalogue | **Done and tested** (sample provider, no credentials) |
| Itinerary items with day index, accept/pass | **Data layer done and tested**; no API or UI |
| Booking hold and confirm | **Done and tested** end to end, but descoped from the MVP |
| Telegram concierge and proactive engine | **Done and tested** |
| HTTP API | **Not started** |
| Chat onboarding endpoint | **Not started** |
| Recommendation ranking | **Not started** |
| React frontend | **Not started** |
| Telegram `/link` code redemption command | **Not started** (the repo function exists and is tested) |

## What this pass did

Unbroke the refactor and put the previously-untested data layer under test.

- `TELEGRAM_BOT_TOKEN` is now optional, so the web app will be able to run alone.
- Dropped the Viator client. Only the sample provider ships. The
  `ActivityProvider` interface stays, so a real supplier is a swap rather than a
  rewrite; the Viator client is recoverable from `02e9c06` if wanted.
- `plans` gained `dayIndex` plus a small activity snapshot (provider, product
  code, price, duration), so the itinerary renders without re-querying the
  catalogue and records what was offered at the time.
- Regenerated the migration. Ten typecheck errors are gone.

**Three bugs found and fixed while doing it:**

1. The smoke test was operating on a phantom user. It still keyed everything on
   the Telegram chat id after user ids became opaque, so every assertion past the
   first was reading and writing a user that did not exist.
2. Web-only mode exited immediately and looked like a crash. A bare promise does
   not hold Node's event loop open. It now says plainly that there is nothing to
   serve yet and exits 0; the HTTP server will hold the loop open when it lands.
3. `addPlan` did not accept the new itinerary fields, so day indexes were
   silently dropped.

## Test coverage

`npm run smoke` - 82 checks, no credentials, real Open-Meteo calls.

Newly covered, all previously unexecuted:

- Opaque identity, and that a Telegram chat id is now an attribute rather than a key
- Web sessions: create, resolve, reject unknown tokens, survive a merge
- Link codes: issue, readable format, reissue retires the previous code, reject
  unknown, reject spent
- **The user merge** - the piece flagged as highest-risk. Verified that rows move
  across tables, that both sides' preferences survive, that exactly one current
  stay remains, that the chat id lands on the survivor, that the old traveler is
  deleted, and that the browser session still resolves afterwards.
- Sample catalogue: determinism across calls, budget ceiling, interest ranking,
  product code round-trip, any destination yields results
- Full booking path: availability, hold, confirm, persistence, and that a spent
  hold cannot be replayed into a double booking
- Itinerary items: day index stored, passed-on items hidden from the itinerary
  and from the model's context but retained

## Deliberate gaps

**Nothing that calls the model has ever run.** There are no Anthropic credentials
on this machine. The extraction pass, reply agent, nudge agent, journal and photo
captioning all typecheck against the SDK and are structurally exercised, but no
model call has been made. The smoke test covers everything around them.

This matters more now: a chat-based onboarding is inherently a model call, so the
MVP's primary path cannot be verified here. A deterministic fallback parser for
simple inputs (`"Lima for 5 days"`) is planned so there is a testable path and
graceful degradation when the API is unavailable.

**Bookings are built but unused by the MVP.** The table, the provider methods and
the tests all exist. Left in place rather than deleted - it is the next stage.

## Next

1. HTTP API: session cookie middleware, trip state, chat turn, recommendations,
   accept/pass, itinerary.
2. Chat onboarding: reuse the existing extraction pass, add an onboarding-tuned
   agent, add the deterministic fallback parser.
3. Recommendation ranking against memory, excluding already-decided products.
4. React frontend: chat, recommendations, day-by-day itinerary map.
5. Telegram command to redeem a link code.
