# Status

> **`main` does not currently compile.** This is a deliberate checkpoint of an
> in-progress refactor, not a working state. `npm run typecheck`, `npm run build`
> and `npm run smoke` all fail. See [Getting back to green](#getting-back-to-green).

Last updated: 2026-08-09.

## Where things are

The Telegram concierge (commit `60c5450`) was complete and verified. Adding the
web app required decoupling identity from Telegram, and that refactor is half
done: the data layer and the activity/booking providers are written, and nothing
above them has been updated to match.

| Area | State |
|---|---|
| Telegram bot, proactive engine, LLM passes | Was working at `60c5450`; **call sites now broken** by the identity refactor |
| Data model (identity, sessions, link codes, bookings) | Written, **never run** |
| Activity provider interface + sample catalogue | Written, **never run** |
| Viator client | Written, **never run**, and partly unverifiable (see below) |
| HTTP API | **Not started** |
| React frontend | **Not started** |
| LLM freeform parsing / recommendation ranking | **Not started** |
| Telegram link-code command | **Not started** |

## What is broken right now

Ten typecheck errors, in three clusters. All are consequences of the identity
refactor landing before its callers were updated.

**1. `config` is missing the new keys** (7 errors, `src/providers/viator.ts`, `src/providers/index.ts`)

`src/config.ts` was never extended. The providers reference `config.activityProvider`
and `config.viator.{apiKey,sandbox,bookingMode,currency,partnerId}`, none of which
exist yet. `TELEGRAM_BOT_TOKEN` is also still mandatory, which was supposed to
become optional so the web app can run standalone.

**2. `getOrCreateUser` no longer exists** (2 errors, `src/bot/telegram.ts`, `scripts/smoke.ts`)

It was replaced by `getOrCreateUserByTelegram(chatId, name)` and `createUser(name)`
now that `users.id` is an opaque id rather than the Telegram chat id.

**3. Stale migration** (not a typecheck error - fails at runtime)

`drizzle/0000_regular_omega_red.sql` predates the schema change. It is missing the
`sessions`, `link_codes` and `bookings` tables, and the new `stays` and `users`
columns. Nothing is deployed, so the migration should be regenerated from scratch
rather than added to.

## What has never been executed

Everything written in this session. Not one line of it has run.

- `src/db/schema.ts` - the reshaped `users` table, and `sessions`, `link_codes`, `bookings`
- `src/db/repo.ts` - session handling, link codes, booking CRUD
- `redeemLinkCode` and its user merge - **the highest-risk untested code in the repo.**
  It moves every row owned by one traveler onto another across seven tables,
  frees a unique index before reassigning it, and resolves the resulting
  two-current-stays conflict. It has never been run even once. It deserves
  dedicated smoke coverage before it is trusted with real data.
- `src/util/ids.ts` - id/token/code generation and the seeded PRNG
- `src/providers/fixtures.ts` - the sample catalogue and its hold/confirm path
- `src/providers/viator.ts` - the entire client
- `src/providers/index.ts` - provider selection

Two bugs were found and fixed by reading rather than running, which is worth
noting because it suggests more are still there:

- Sample product codes could not be decoded unambiguously, because both the city
  slug and the archetype slug contain hyphens. Now underscore-delimited.
- The cold-start path recovered a city from an uppercase code and would have
  rendered titles like "LIMA Old Town Walking Tour". Now title-cased, and backed
  by a warm in-memory index so decoding is only a fallback.

## What is unverified against Viator

`src/providers/viator.ts` mixes confirmed and unconfirmed detail. The class
docstring says the same thing; repeating it here so it is not a surprise.

**Confirmed from Viator's published documentation:**

- Base URLs: `https://api.viator.com/partner`, `https://api.sandbox.viator.com/partner`
- Auth header: `exp-api-key`
- Endpoint paths: `/search/freetext`, `/products/search`, `/products/{code}`,
  `/availability/check`, `/bookings/cart/hold`, `/bookings/cart/book`
- Sort values: `DEFAULT`, `TRAVELER_RATING`, `PRICE`
- Search must be scoped by destination, category or attraction
- The API is versioned through the `Accept` header

**Not confirmed:** every request body field name, and every response shape.
Viator's docs are client-rendered and could not be scraped, and there was no API
key available to probe the sandbox. All of the guesswork is deliberately confined
to `#mapProduct`, the `availability` mapping, and the request builders - when a
key arrives, those should be the only places that need editing.

**Access tier matters more than the code does.** Viator gates
`/bookings/cart/hold` and `/bookings/cart/book` behind Full+Booking affiliate or
Merchant access, both of which require Viator authorization and certification. A
plain affiliate key cannot book in-app at all; it must use `deeplink` mode, where
the traveler completes the purchase on viator.com. The provider exposes
`bookingMode` for exactly this reason, and deletes the `hold`/`book` methods in
deeplink mode so callers can feature-detect rather than fail at runtime.

## Design decisions already made

Settled, so the remaining work does not need to relitigate them:

- **React SPA + REST API on the existing service.** One backend owns trip memory;
  web and Telegram read the same state with no sync layer.
- **Fixture-first.** The sample provider is fully functional so the entire
  search to confirm path is demoable with no credentials. Real Viator swaps in
  behind a config flag.
- **Anonymous session + link code.** A cookie identifies the visitor immediately
  so onboarding starts with zero friction; sending a short code to the bot merges
  the two identities. No passwords, no email, no auth service.
- **Structured answers must not require the LLM.** Chips and pickers write state
  through a pure code path; freeform text is the only thing that needs a model
  call. This keeps the whole flow testable without credentials, which is how the
  Telegram half ended up well covered.

## Getting back to green

In order. None of this is large; it is roughly an hour of work.

1. Extend `src/config.ts`: add `activityProvider`, the `viator` block, and
   `httpPort`. Make `TELEGRAM_BOT_TOKEN` optional and skip starting the bot when
   it is absent.
2. Update the two `getOrCreateUser` call sites to `getOrCreateUserByTelegram`.
3. `rm -rf drizzle && npx drizzle-kit generate` to regenerate the migration.
4. `npm run typecheck` until clean, then `npm run smoke`.
5. Extend `scripts/smoke.ts` to cover sessions, link-code redemption and the
   merge, the sample catalogue, and a full hold/confirm booking. The merge in
   particular should not be trusted until it is covered.

Then the HTTP API and the frontend, neither of which is started.
