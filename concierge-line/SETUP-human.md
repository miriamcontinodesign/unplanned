# SETUP — the parts a human has to click

The app **runs right now with none of this** (see [Zero-credential mode](#zero-credential-mode) at
the bottom). Everything here is what turns the fake call into a real one.

Work top to bottom. Paste each value into `.env` as you get it. Total: ~25 minutes if nothing fights
you.

---

## 0. Make the .env

```powershell
cd D:\Projects\summer26\Hackathon\roadio\concierge-line
Copy-Item .env.example .env
notepad .env
```

Never paste a key into a terminal command or a chat message — transcripts persist to disk. Type it
into `.env` only.

---

## 1. Twilio — buy a voice number  (~5 min)

Account is already upgraded to Pay-As-You-Go, so there's no trial preamble and no verified-number
restriction. You still need a number.

1. <https://console.twilio.com> → **Phone Numbers → Manage → Buy a number**
2. Country **United States**, tick capability **Voice**. Local number, ~$1.15/mo.
3. Buy it. Write the number down in E.164 form: `+1XXXXXXXXXX`.
4. From the Console dashboard home, copy **Account SID** and **Auth Token** — ElevenLabs needs both
   in step 3. Don't put them in `.env`; they go into the ElevenLabs UI once.

> A2P 10DLC registration governs **SMS**, not voice. We are voice-only, so skip it entirely.

---

## 2. ElevenLabs — create the agent  (~7 min)

1. <https://elevenlabs.io> → **Conversational AI → Agents → Create Agent** (blank template).
2. Name it `Iris`.
3. Paste in the three files from `agent/` in this folder:
   - **System prompt** ← `agent/system-prompt.txt`
   - **First message** ← `agent/first-message.txt`
   - Leave the tool config alone for now — that's step 5, after ngrok exists.
4. **Voice:** pick a warm, neutral, mid-paced one. Avoid anything breathy or slow; it reads badly
   over a phone line and eats demo seconds.
5. Enable **interruption handling** if the UI offers it.
6. Copy the **Agent ID** → `.env` as `ELEVENLABS_AGENT_ID`.
7. Profile → **API Keys** → create one → `.env` as `ELEVENLABS_API_KEY`.

---

## 3. ElevenLabs — import the Twilio number  (~4 min)

1. **Conversational AI → Phone Numbers → Import a phone number** (choose Twilio).
2. Paste: the phone number from step 1, the Twilio **Account SID**, the Twilio **Auth Token**.
3. Assign the number to the `Iris` agent.
4. Copy the **phone number ID** ElevenLabs gives back → `.env` as
   `ELEVENLABS_AGENT_PHONE_NUMBER_ID`.

> This is the step that silently fails most often. If the import errors, the cause is almost always
> a wrong Auth Token (they look similar to the SID) or a number without Voice capability.

---

## 4. ngrok — a public URL that survives restarts  (~5 min)

The ElevenLabs agent has to reach this laptop to submit findings mid-call. Without a tunnel, the
result card never fills.

```powershell
winget install --id ngrok.ngrok
# new terminal after install so PATH refreshes
ngrok config add-authtoken <token from dashboard.ngrok.com>
```

Then at <https://dashboard.ngrok.com/domains> claim your **free static domain** (one per account).
It'll look like `something-something.ngrok-free.app`.

```powershell
ngrok http 8000 --domain=<your-static-domain>
```

Put the full `https://` URL in `.env` as `PUBLIC_BASE_URL` (no trailing slash).

> Use the static domain, not a random tunnel. A random URL changes every restart, and every restart
> means re-editing two webhook URLs in the ElevenLabs dashboard by hand. That is exactly the kind of
> five-minute task that becomes a twenty-minute task at 5 PM.

Also invent a webhook secret and put it in `.env` as `ELEVENLABS_WEBHOOK_SECRET` — any random
string. It gates the two public endpoints.

---

## 5. ElevenLabs — wire the tool and the post-call webhook  (~5 min)

Needs `PUBLIC_BASE_URL` from step 4, so do it last.

**a) The `submit_reservation` tool** — this is what makes the confirmation land *during* the call.

- Agent → **Tools → Add tool → Webhook** (server tool)
- Name: `submit_reservation`
- Method: `POST`
- URL: `<PUBLIC_BASE_URL>/api/agent/submit_reservation?secret=<ELEVENLABS_WEBHOOK_SECRET>`
- Description: *"Log the reservation you just made. Call this once, near the end of the call,
  before saying goodbye."*
- Parameters: copy from `agent/tool-schema.json`.
- One parameter is special: `task_id` must be wired to the **dynamic variable** `task_id`, not asked
  of the model. The backend injects it when it places the call.

**b) The post-call webhook**

- Agent settings → **Post-call webhook**
- URL: `<PUBLIC_BASE_URL>/api/webhooks/elevenlabs/post-call?secret=<ELEVENLABS_WEBHOOK_SECRET>`

---

## 6. Anthropic + optional keys  (~3 min)

- `ANTHROPIC_API_KEY` — <https://console.anthropic.com/settings/keys>. Used only for the
  client-ready note. If it's missing the app writes the note from a template instead, so this is a
  polish item, not a blocker.
- `TAVILY_API_KEY` — optional. Pre-call policy brief. Skip if short on time.
- `STAY22_API_KEY` — leave blank. Demo mode works keyless at 5 requests/minute.

---

## 7. Pre-flight, right before the demo

```powershell
# is everything the app can see actually there?
Invoke-RestMethod http://127.0.0.1:8000/api/health | ConvertTo-Json
```

Every `has_*` flag should be `true` and `fake_call_mode` should be `false`.

Then, physically:

- [ ] `DEMO_TO_NUMBER` in `.env` is the receiving phone, E.164, and that phone is **on and charged**
- [ ] Receiving phone on **speaker**, volume max — test it reaches the back of the room
- [ ] A second phone with a hotspot, already paired, in case the venue Wi-Fi dies
- [ ] `ngrok` running on the static domain
- [ ] Backup recording exists at `demo/backup-call.mp4`

---

## Zero-credential mode

Nothing above is needed to develop or to prove the flow. With an empty `.env`:

```powershell
.\venv\Scripts\Activate.ps1
uvicorn app:app --port 8000 --workers 1
```

`/api/health` reports every capability as `false`, and **Call and book it** runs a scripted fake
call — status advances, transcript streams in, the confirmation lands mid-run — through the exact
same code path a real call uses. That's the safety net: if telephony never comes together, this
still demos.
