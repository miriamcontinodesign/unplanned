# Status

Last updated: 2026-08-09.

Backend and web app both compile, build, and pass 105 smoke checks. The MVP flow -
chat onboarding to recommendations to a day-by-day itinerary - runs end to end
with no credentials at all.

## MVP target

A chat-based onboarding that captures **where** and **how many days**, leads to a
**recommended set of activities**, and feeds a **structured day-by-day itinerary
map** built from what the traveler accepted or passed on. Bookings are a later
stage. No third-party integrations.

## Where things stand

| MVP piece | State |
|---|---|
| Chat onboarding (destination + days) | **Done**, verified through the API |
| Trip memory: destination, days, preferences | **Done and tested** |
| Recommended activities with reasons | **Done**, verified through the API |
| Accept / pass, with passed items excluded from future picks | **Done**, verified through the API |
| Day-by-day itinerary flow map | **Done**, verified through the API |
| Web identity: sessions, Telegram linking, user merge | **Done and tested** |
| Activity catalogue | **Done and tested** (sample provider, no credentials) |
| Telegram concierge and proactive engine | **Done**; reply agent verified live, proactive engine still untested |
| Booking hold and confirm | Built and tested, but descoped from the MVP |
| Telegram `/link` command to redeem a code | **Not started** (the repo function exists and is tested) |
| LLM enrichment of chat parsing | **Not started** |

## Running it

```bash
npm run dev        # API on :8787 (and the bot, if a token is set)
npm run web:dev    # SPA on :5173, proxies /api to :8787
```

Open http://localhost:5173 and say something like "Lisbon for 5 days".

Neither an OpenRouter key nor a Telegram token is required for the web flow.

## The one architectural call worth knowing

**Chat onboarding is deterministic, not a model call.**

Free text is normally a model call, but the two things onboarding must capture -
a place and a duration - are narrow enough to parse in code, and the place can be
*verified* by geocoding rather than guessed. So `src/onboarding/parse.ts` is the
primary path: regex for duration, party size, budget and interest keywords, and a
real geocoding lookup to confirm the destination exists.

That keeps the core flow working with no credentials, costs nothing per turn, and
gives a deterministic path to test. The model layers on top to catch what this
misses.

**What it misses, concretely:** negation. Tested with *"I love food and street
markets, nothing too touristy"*, it records `like: food` and silently drops
"nothing too touristy". Anything requiring inference rather than matching needs
the model pass.

## Verified, and how

**105 smoke checks** (`npm run smoke`) - no credentials, real Open-Meteo calls.
Covers migrations, opaque identity, web sessions, link codes and the user merge,
the sample catalogue, the full booking path, the proactive gates, per-traveler
serialisation, and the conversation window.

**The MVP flow was driven through the API by hand** before shipping: chat turn
resolving "Lisbon for 5 days" to a geocoded destination, recommendations with
grounded reasons, accept landing on the chosen day, pass removing the card, and
both accepted and passed items confirmed absent from subsequent recommendations.

**The frontend has never been looked at.** The Chrome extension was not connected,
so there is no visual confirmation that it renders correctly. What *is* verified:
both typechecks pass, all nine modules transform cleanly through Vite, and the
production build succeeds. Layout, spacing and visual polish are unverified.

**The model layer now runs, on OpenRouter.** Verified live against
`google/gemini-2.5-flash-lite`: the extraction pass returns valid structured
output and its writes land (stay recorded, preference captured, geocoding
fired); the reply agent completes a tool-calling loop with `get_weather` and
`search_experiences` confirmed to dispatch for real rather than be described;
the journal renders. The whole run cost about a fifth of a cent.

**Still unexercised against a live model:** photo captioning (the only vision
path), the nudge agent, and the Telegram surface.

## Next

1. Look at the frontend and fix whatever is visually wrong.
2. Telegram command to redeem a link code, closing the web-to-chat loop.
3. LLM enrichment on chat turns: run the model when the deterministic parser
   comes back empty, so negation and nuance are caught.
4. Bookings, when they come back into scope.
