# Unplanned

A same-day activity concierge, in a web app. Tell it where you are and what you're in the mood
for, and it finds things worth doing right now nearby - no itinerary, no multi-day planning,
just what's good for this afternoon or tonight.

The canonical one-minute product narrative is documented in [the demo user story](docs/demo-user-story.md)
(pre-dates the current single-day scope - read it for the general shape, not the specifics).

## Status

Web app runs end to end: chat, recommendations, accept/pass. Chat is
fully OpenRouter-backed and needs `OPENROUTER_API_KEY` set. See [STATUS.md](./STATUS.md) for
what is and is not verified (also predates the current scope in places).

## Running it

```bash
npm install
cp .env.example .env   # set OPENROUTER_API_KEY - the chat needs it, see Setup below
npm run dev             # API on :8787
npm run web:dev         # SPA on :5173, proxies /api to :8787
```

Open http://localhost:5173 and say where you are and what you're up for.

## How it works

Every chat turn runs two model passes, deliberately separated:

1. **Extraction.** A forced structured-output call reads the newest message and emits a state delta - city, lodging, budget, party size, preferences. This is the only thing that writes trip state.
2. **Reply.** An agentic call with weather and live Viator experience search answers the traveler.

Splitting them is the point. If a single chatty call had to both answer well *and* remember to record that you just moved to Cusco, it would sometimes forget - and you'd never know until a suggestion came back for the wrong city. Extraction runs on a schema, so it can't quietly skip.

```
web chat ──> extraction pass ──> SQLite (stay, preferences)
                    │                         │
                    └──> reply pass <─────────┘
                              │
                      weather + Viator
```

### Layout

| Path | What lives there |
|---|---|
| `src/llm/prompts.ts` | System prompts. The product's voice, and the rules for state extraction. |
| `src/llm/agent.ts` | The tool-use loop the reply pass runs on. |
| `src/llm/extract.ts` | Structured state extraction and how deltas get applied. |
| `src/llm/state.ts` | How trip state is rendered for the model. |
| `src/db/schema.ts` | Trip state: stays, plans, preferences. |
| `src/tools/` | Built-in `get_weather` agent tool. |
| `src/components/viator.ts` | Viator component and its `search_experiences` agent tool. |
| `src/components/viator.mock.ts` | Deterministic mock experience catalog and lightweight local search. |
| `src/services/viator.ts` | Viator MCP connection, retry policy, validation, and compact result formatting. |
| `src/onboarding/engine.ts` | Phase (need-destination/ready), greeting, and destination write-through shared by chat and the silent location endpoint. |
| `src/onboarding/recommend.ts` | Ranking the catalogue against trip memory. |
| `src/http/server.ts` | REST API and the session cookie. |
| `src/providers/` | The activity catalogue behind a swappable interface. |
| `web/` | Vite + React SPA: chat, recommendation carousels, picks. |

## Setup

Needs Node 20+.

```bash
npm install
cp .env.example .env      # set OPENROUTER_API_KEY - see below
npm run db:generate       # only needed if you change src/db/schema.ts
npm run dev
```

**`OPENROUTER_API_KEY`** - from [openrouter.ai/keys](https://openrouter.ai/keys). Required for
the chat: it's fully LLM-backed with no fallback. `npm run smoke` runs without it (it never
calls the HTTP chat route). `ROADIO_MODEL` picks the OpenRouter model slug and defaults to
`google/gemini-2.5-flash-lite`.

Bookable experience search uses Viator's hosted MCP endpoint and needs no separate API key. `ROADIO_VIATOR_MCP_URL` can override the endpoint if Viator changes it.

For local demos and deterministic tests, set `ROADIO_VIATOR_MOCK=true`. Roadio then uses the same `search_experiences` component against a fixture catalog without making network calls. It includes cooking experiences in Lisbon, Brooklyn, New Orleans, San Francisco, Austin, Chicago, Rome, Tokyo, and Barcelona, plus food-tour and kayaking examples. Mock booking links end in `example.invalid`, and US mock operators use reserved `+1 ... 555-01xx` fictional numbers. Results mark those contacts as mock data so a downstream calling component can refuse to dial them.

## Testing

```bash
npm run smoke       # no API keys needed
npm run typecheck
```

`npm run smoke` runs against a throwaway database and hits the real Open-Meteo API. It covers migrations, the trip-state write path, web sessions, account linking and its user merge, the sample activity catalogue and full booking path, geocoding, weather, per-traveler serialisation, and the conversation window. It needs a network connection but no credentials.

It deliberately does **not** cover the model calls. Those need an API key, and asserting on model output is a different kind of test - see below.

## Design notes

**Why the extraction pass is separate.** Covered above: reliability of state beats one fewer API call.

**Why a manual tool-use loop** rather than the SDK's tool runner: this is a long-running process and the runner is a beta surface - a hand-written loop keeps one obvious place to bound iterations and log what the model reached for.

**Why Open-Meteo** rather than a places API: it's free, needs no key, and returns coordinates, IANA timezones and ISO country codes in one call.

**Effort levels** are tuned per call site in `src/config.ts`: `low` for extraction, `medium` for replies (interactive, latency matters).

**Prompt caching.** System prompts are split into a stable block carrying the cache breakpoint and a volatile block with trip state and local time. Don't interpolate anything dynamic into the strings in `prompts.ts` - it would silently kill the cache on every request.

## Not built yet

- **The reply agent has run live on OpenRouter; other paths are less exercised.** Expect prompt tuning on first contact. See [STATUS.md](./STATUS.md) (pre-dates the current scope).
- **Trip state is never pruned.** Preferences accumulate forever and all of them go into every system prompt. Fine for a session or two; needs summarisation for a long-running one.
- **No retry on transient API failures.** The SDK retries 429s and 5xxs itself; anything past that surfaces to the traveler as an error bubble in the chat.
- **Single-process, SQLite.** Deliberate for v1. Drizzle keeps the door open to Postgres later.
