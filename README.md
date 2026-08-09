# Roadio

A travel concierge that lives in a Telegram thread.
It learns where you are from what you tell it, remembers the shape of your trip, and speaks up unprompted when there's something worth doing.

The canonical one-minute product narrative is documented in [the demo user story](docs/demo-user-story.md).

Ask it anything and it answers with your actual context in mind - where you're staying, what the weather is doing, how long you've got left, what you've already told it you hate.

## Status

The v1 core is built: **location memory and proactive suggestions**.
Journal capture (notes and photos) and a `/journal` summary are in, but basic.

What is not built yet is listed under [Not built yet](#not-built-yet).

## How it works

Every inbound message runs two model passes, deliberately separated:

1. **Extraction.** A forced structured-output call reads the newest message and emits a state delta - city, lodging, dates, plans, preferences, journal entries. This is the only thing that writes trip state.
2. **Reply.** An agentic call with weather, web search, and live Viator experience search answers the traveler.

Splitting them is the point. If a single chatty call had to both answer well *and* remember to record that you just moved to Cusco, it would sometimes forget - and you'd never know until a suggestion came back for the wrong city. Extraction runs on a schema, so it can't quietly skip.

Separately, a scheduler ticks every 15 minutes. For each traveler it checks cheap deterministic gates (quiet hours in *their* timezone, daily cap, minimum gap since the last message), and only then spends a model call deciding whether anything is worth saying. The model's only way to send is to call a `send_nudge` tool; not calling it is how it stays quiet, which is the expected outcome most of the time.

```
Telegram ──> extraction pass ──> SQLite (stays, plans, preferences, journal)
                    │                         │
                    └──> reply pass <─────────┘
                              │
                 weather + web + Viator

scheduler ──> gates ──> nudge agent ──> send_nudge? ──> Telegram
   (15m)   (quiet hours,   (weather,      (usually
            cap, gap)     web search)      not)
```

### Layout

| Path | What lives there |
|---|---|
| `src/llm/prompts.ts` | All system prompts. The product's voice and the bar for interrupting someone. |
| `src/llm/agent.ts` | The tool-use loop shared by the reply and nudge paths. |
| `src/llm/extract.ts` | Structured state extraction and how deltas get applied. |
| `src/llm/state.ts` | How trip state is rendered for the model. |
| `src/proactive/nudge.ts` | The deterministic gates, then the decision agent. |
| `src/db/schema.ts` | Trip state: stays, plans, preferences, journal, nudges. |
| `src/tools/` | Roadio's built-in `get_weather`, `web_search`, and `send_nudge` tools. |
| `src/components/viator.ts` | Roadio-facing Viator component and its `search_experiences` agent tool. |
| `src/components/viator.mock.ts` | Deterministic mock experience catalog and lightweight local search. |
| `src/services/viator.ts` | Viator MCP connection, retry policy, validation, and compact result formatting. |

## Setup

Needs Node 20+.

```bash
npm install
cp .env.example .env      # then fill in the two values below
npm run db:generate       # only needed if you change src/db/schema.ts
npm run dev
```

**`TELEGRAM_BOT_TOKEN`** - message [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`, follow the prompts, paste the token it gives you.

**`ANTHROPIC_API_KEY`** - from [console.anthropic.com](https://console.anthropic.com/settings/keys). If you've run `ant auth login` you can leave this blank; the SDK picks up the profile.

Then open Telegram, find your bot, and send it something like:

> just landed in Lima, staying at a hostel in Miraflores until Sunday

From then on it knows where you are.

Bookable experience search uses Viator's hosted MCP endpoint and needs no separate API key. `ROADIO_VIATOR_MCP_URL` can override the endpoint if Viator changes it.

For local demos and deterministic tests, set `ROADIO_VIATOR_MOCK=true`. Roadio then uses the same `search_experiences` component against a small fixture catalog—cooking classes in Brooklyn, Rome, Tokyo, and Barcelona, plus food-tour and kayaking examples—without making network calls. Mock booking links end in `example.invalid`, and mock operator contacts use reserved `+1 212 555-01xx` fictional numbers. Results mark those contacts as mock data so a downstream calling component can refuse to dial them.

## Commands

| Command | Effect |
|---|---|
| `/status` | Where it thinks you are, what it's recorded, current nudge settings |
| `/journal` | Narrative summary of the trip so far |
| `/pause`, `/resume` | Stop and restart unprompted messages (replies still work while paused) |
| `/quiet 22-7` | Quiet hours in your local time |
| `/limit 2` | Max unprompted messages per day; `/limit 0` disables them |

Send a photo and it gets captioned and filed in the journal.

## Testing

```bash
npm run smoke       # ~40 checks, no API keys needed
npm run typecheck
```

`npm run smoke` runs against a throwaway database and hits the real Open-Meteo API. It covers migrations, the state write path, geocoding, weather, the proactive gates, per-traveler serialisation, and the conversation window. It needs a network connection but no credentials.

It deliberately does **not** cover the model calls. Those need an API key, and asserting on model output is a different kind of test - see below.

## Design notes

**Why the extraction pass is separate.** Covered above: reliability of state beats one fewer API call.

**Why "say nothing" is a first-class outcome.** The way this product fails is by being annoying. The quiet-hours, daily-cap and minimum-gap gates are enforced in code rather than left to the model's judgment, so they're guarantees a traveler can actually rely on. Everything above that bar is the model's call, and its prompt tells it that an unsent good suggestion costs almost nothing while an unwanted notification costs trust.

**Why a manual tool-use loop** rather than the SDK's tool runner: this is a long-running process and the runner is a beta surface, and mixing in the server-side web search means `pause_turn` has to be resumed by hand anyway - which is most of what the runner would have done here.

**Why Open-Meteo and web search** rather than a places API: Open-Meteo is free, needs no key, and returns coordinates, IANA timezones and ISO country codes in one call. For "what's actually good near here", web search beats a places API - a places API gives you pins, not taste. A places API is the right addition later for precise distances and opening hours.

**Effort levels** are tuned per call site in `src/config.ts`: `low` for extraction, `medium` for replies (interactive, latency matters), `high` for nudges (unattended, and deciding *not* to interrupt someone is the judgment call worth paying for).

**Prompt caching.** System prompts are split into a stable block carrying the cache breakpoint and a volatile block with trip state and local time. Don't interpolate anything dynamic into the strings in `prompts.ts` - it would silently kill the cache on every request.

## Not built yet

- **Nothing has been run against the live model.** The request shapes typecheck against the SDK, and everything around them is covered by `npm run smoke`, but no reply, nudge, extraction or caption has actually been generated. Expect prompt tuning on first contact.
- **Trip state is never pruned.** Preferences and plans accumulate forever and all of them go into every system prompt. Fine for a few weeks; needs summarisation for a long trip.
- **The scheduler processes travelers sequentially** in one process. Correct for a handful of users, not for a fleet - it wants a work queue before it grows.
- **Journal generation is basic** and doesn't use the photos, only their captions.
- **No retry on transient API failures.** The SDK retries 429s and 5xxs itself; anything past that surfaces to the traveler as "try me again in a second".
- **Single-process, SQLite, long polling.** Deliberate for v1. Drizzle keeps the door open to Postgres, and the bot can move to webhooks without touching anything above the transport.
