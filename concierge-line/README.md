# Concierge Line

An AI voice agent that phones restaurants, bars, and tour operators on a traveler's behalf,
books the table, and returns a structured confirmation — **while the call is still happening**.

One of three modules in the Roadio hackathon build. Self-contained Python service; it shares
no build, no dependencies, and no process with the TypeScript app at the repo root.

```
Browser console (vanilla JS, polls every 1.5s)
      |  REST
      v
FastAPI :8000  ──> Stay22 /v2/accommodations   (nearby inventory, 10-min TTL cache)
               ──> Tavily /search              (pre-call brief)
               ──> Anthropic                   (confirmation note, post-call only)
      ^   |
      |   └──> POST ElevenLabs /convai/twilio/outbound-call ──┐
      |                                                       v
      └──── submit_reservation + post-call webhook ◄──── ElevenLabs Agent
                    (via ngrok public URL)                     |
                                                               v
                                                          Twilio PSTN
                                                               |
                                                               v
                                                      restaurant / bar / tour
```

## Run it

```powershell
cd concierge-line
py -m venv venv ; .\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env      # optional - it runs empty
uvicorn app:app --reload --port 8000 --workers 1
```

Open <http://127.0.0.1:8000>. **It works with a completely empty `.env`** — see
[Zero-credential mode](#zero-credential-mode). For real phone calls, follow
[SETUP-human.md](./SETUP-human.md).

Single worker is required: the task store is in-process.

## Zero-credential mode

Every dependency degrades on its own, so the demo survives a dead network:

| Missing | What happens |
|---|---|
| ElevenLabs | **Call** runs a scripted fake call — status advances, transcript streams, the confirmation lands at ~25s — through the same code path a real call uses |
| Anthropic | Confirmation note comes from a deterministic template instead of Claude |
| Stay22 | Keyless demo mode (5 req/min); on 429 it serves the stale cache |
| Tavily | Pre-call brief is simply empty |

`GET /api/health` reports exactly which of these are live.

Set `FAKE_CALL_SPEED=6` to make the ~40s scripted call run in ~7s while developing.

## API

Every `/api/*` route returns JSON, CORS is wide open, and there is no auth or session state —
so the team's main dashboard can drive this module without touching Python.

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | The console |
| GET | `/api/health` | Capability flags — `has_elevenlabs`, `has_anthropic`, `fake_call_mode`, … |
| GET | `/api/tasks` | All tasks, newest first. **Poll this every 1.5s.** |
| GET | `/api/tasks/{id}` | One task |
| POST | `/api/tasks` | Create a task (body below) |
| POST | `/api/tasks/{id}/call` | Fire the call. **Returns immediately** — see below |
| POST | `/api/tasks/{id}/simulate` | Fill a canned result instantly. Demo insurance; never shown on stage |
| POST | `/api/tasks/{id}/summarize` | Regenerate the traveler note |
| POST | `/api/agent/submit_reservation` | **Agent tool webhook.** Public via ngrok |
| POST | `/api/webhooks/elevenlabs/post-call` | Transcript + completion. Public via ngrok |
| GET | `/api/search?address=&checkin=&checkout=&adults=` | Stay22 proxy |

### The call is non-blocking

`POST /api/tasks/{id}/call` sets status to `dialing`, spawns the call in the background, and
returns in ~150ms. It never awaits telephony. **All subsequent UI state comes from polling** —
which is what lets the presenter hit Call and keep talking while the confirmation lands.

```json
{ "ok": true, "mode": "fake", "task_id": "t_ab12cd", "status": "dialing" }
```

### Task shape

```jsonc
{
  "id": "t_ab12cd",
  "created_at": "2026-08-09T13:40:00-04:00",
  "status": "queued | dialing | in_progress | completed | failed",
  "venue":   { "name": "The Local", "kind": "restaurant", "phone": "+1…", "address": "…" },
  "request": { "date": "2026-08-13", "time": "19:00", "party_size": 2, "asks": ["…"] },
  "traveler":{ "name": "Nishanth", "notes": "anniversary, table outside" },
  "briefing":{ "policy_brief": "≤600 chars", "sources": ["https://…"] },
  "conversation_id": null,
  "result": {                       // written by the agent's mid-call tool call
    "reservation_confirmed": true,
    "confirmed_time": "8:45 PM",
    "party_size": 2,
    "name_on_reservation": "Nishanth",
    "alternatives_offered": ["7:15 PM"],
    "special_requests_status": "Terrace table noted",
    "confidence": "high | medium | low",
    "notes": "Arrive five minutes early."
  },
  "transcript": [ { "role": "agent|caller", "text": "…", "ts": 12.5 } ],
  "summary_markdown": "Nishanth — you're booked at The Local. …",
  "summary_source": "claude | template"
}
```

`POST /api/tasks` takes `venue`, `request`, and `traveler`; only `venue.name` is required.

## Design notes

**The result card comes from the agent's tool call, not from an LLM reading a transcript.**
That is what makes it land mid-call, and it is why a slow or missing Anthropic key can't
empty the card. Claude only writes prose on top of an already-structured result.

**Everything the agent needs is pre-injected as dynamic variables.** Tools are for *writes*
(`submit_reservation`), never for reads the backend already knows — a mid-call read is latency
the room hears as silence, plus a failure surface we don't control.

**Two functions deliberately swallow errors, and only two.** `apply_reservation` coerces
whatever the agent sends rather than 4xx-ing a live call (a rejected tool call is dead air on
stage), and `claude_note` falls back to the template on any Anthropic failure. Everywhere else
errors raise.

**The webhook body shape is defensive on purpose.** ElevenLabs' outgoing webhook-tool body
envelope is undocumented — their docs describe the tool as an HTTP request builder, implying a
flat body, but there is no verbatim example. `unwrap_tool_body` accepts both flat and
`{"parameters": {…}}`, so either is correct. Confirm the real shape once against a webhook.site
bin.

**Stay22 results are never written to disk.** Their terms forbid cold-storing listings, so
search payloads live in an in-memory TTL cache only; `store.json` holds only the venue the
traveler confirmed.

## Verified API shapes

Checked against live docs on 2026-08-09. Don't "fix" these back to guesses:

- ElevenLabs outbound: `POST /v1/convai/twilio/outbound-call`, header `xi-api-key`, body
  `agent_id` / `agent_phone_number_id` / `to_number` /
  `conversation_initiation_client_data.dynamic_variables`. Response `conversation_id` and
  `callSid` are both nullable — gate on `success`.
- ElevenLabs post-call: `{type, event_timestamp, data{conversation_id, transcript[]}}`; a turn
  is `{role: "agent"|"user", message, time_in_call_secs}` — **not** text/ts. Branch on `type`
  (`post_call_transcription` | `post_call_audio` | `call_initiation_failure`).
- Tavily auth is `Authorization: Bearer …`, **not** `api_key` in the body.
- Stay22 nests deeper than you'd guess: `results[].location.address`,
  `.location.coordinates.lat/lng`, `.rating.value`, `.media.thumbnail`, and `suppliers` is a
  **sparse** map — iterate its keys rather than hardcoding supplier names.
