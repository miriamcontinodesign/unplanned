"""Concierge Line - an AI voice agent that phones venues to book for a traveler.

Run:  uvicorn app:app --reload --port 8000 --workers 1
      (single worker - the task store is in-process)

The store is a JSON file and every route under /api returns JSON, so the team's
main dashboard can consume this module without touching Python.
"""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse

load_dotenv()

import agents
import providers
import store

TEMPLATES = Path(__file__).parent / "templates"

# asyncio.create_task only holds a weak reference; without this the GC can
# collect a running call mid-demo.
_BACKGROUND: set[asyncio.Task[Any]] = set()


def _spawn(coro: Any) -> None:
    task = asyncio.create_task(coro)
    _BACKGROUND.add(task)
    task.add_done_callback(_BACKGROUND.discard)


DEFAULT_ASKS = [
    "confirm the booking",
    "confirm the time",
    "ask about outdoor seating",
    "note anything we should know before arriving",
]


# --------------------------------------------------------------------------
# Seed - never demo from an empty screen
# --------------------------------------------------------------------------

def _seed() -> None:
    if store.TASKS:
        return

    def task(
        task_id: str,
        name: str,
        kind: str,
        phone: str,
        address: str,
        when: str,
        at_time: str,
        party: int,
        status: str,
        result: dict[str, Any] | None,
        traveler: str,
        notes: str,
    ) -> dict[str, Any]:
        return {
            "id": task_id,
            "created_at": store.now_iso(),
            "status": status,
            "venue": {"name": name, "kind": kind, "phone": phone, "address": address, "stay22_ref": None},
            "request": {"date": when, "time": at_time, "party_size": party, "asks": list(DEFAULT_ASKS)},
            "traveler": {"name": traveler, "notes": notes},
            "briefing": {"policy_brief": "", "sources": []},
            "conversation_id": None,
            "result": result,
            "transcript": [],
            "summary_markdown": None,
            "booking_link": None,
        }

    store.TASKS["t_seed01"] = task(
        "t_seed01", "Bar Tulia", "restaurant", "+12395550118",
        "1300 Third St S, Naples, FL", "2026-08-11", "19:30", 2, "completed",
        {
            "reservation_confirmed": True, "confirmed_time": "7:30 PM", "party_size": 2,
            "name_on_reservation": "Nishanth",
            "alternatives_offered": [],
            "special_requests_status": "Window table noted",
            "confidence": "high", "notes": "Kitchen closes at 10. Smart casual.",
        },
        "Nishanth", "first night, wants somewhere lively",
    )
    store.TASKS["t_seed02"] = task(
        "t_seed02", "Sunset Catamaran Cruise", "tour", "+12395550143",
        "Tin City Dock, Naples, FL", "2026-08-12", "18:00", 2, "completed",
        {
            "reservation_confirmed": False, "confirmed_time": "", "party_size": 2,
            "name_on_reservation": "",
            "alternatives_offered": ["Thursday 6:00 PM", "Friday 4:30 PM"],
            "special_requests_status": "",
            "confidence": "high",
            "notes": "Wednesday sunset sailing is fully booked. Two alternatives held informally for 24h.",
        },
        "Nishanth", "wants sunset, flexible on the day",
    )
    store.TASKS["t_seed03"] = task(
        "t_seed03", "The Local", "restaurant", "+12395550166",
        "5323 Airport Pulling Rd N, Naples, FL", "2026-08-13", "19:00", 2, "queued",
        None, "Nishanth", "anniversary dinner, would love a table outside",
    )
    store.save()


@asynccontextmanager
async def lifespan(_: FastAPI):
    store.load()
    _seed()
    agents.post_reservation_hook = lambda task_id: _spawn(_attach_summary(task_id))
    mode = "FAKE (no ElevenLabs credentials)" if agents.fake_call_mode() else "LIVE telephony"
    print(f"[concierge] {len(store.TASKS)} tasks loaded. Call mode: {mode}")
    yield


app = FastAPI(title="Concierge Line", lifespan=lifespan)

# Wide open so a teammate's frontend can attach without a CORS fight.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _require_secret(supplied: str | None) -> None:
    """Gate the two publicly-exposed webhook routes.

    If no secret is configured the routes stay open, which is what keeps the
    zero-credential path working.
    """
    expected = os.environ.get("ELEVENLABS_WEBHOOK_SECRET", "").strip()
    if expected and (supplied or "").strip() != expected:
        raise HTTPException(status_code=403, detail="bad secret")


def _task_or_404(task_id: str) -> dict[str, Any]:
    task = store.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"no task {task_id}")
    return task


# --------------------------------------------------------------------------
# Dashboard + health
# --------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def dashboard() -> HTMLResponse:
    html = (TEMPLATES / "index.html").read_text(encoding="utf-8")
    html = html.replace("__AGENT_ID__", os.environ.get("ELEVENLABS_AGENT_ID", "").strip())
    html = html.replace("__MAIN_APP_URL__", os.environ.get("MAIN_APP_URL", "").strip())
    return HTMLResponse(html)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "has_elevenlabs": agents.has_elevenlabs(),
        "has_anthropic": providers.has_anthropic(),
        "has_tavily": providers.has_tavily(),
        "has_stay22_key": bool(os.environ.get("STAY22_API_KEY", "").strip()),
        "fake_call_mode": agents.fake_call_mode(),
        "public_base_url": os.environ.get("PUBLIC_BASE_URL", "").strip() or None,
        "app_name": agents.app_name(),
        "tasks": len(store.TASKS),
    }


# --------------------------------------------------------------------------
# Tasks
# --------------------------------------------------------------------------

@app.get("/api/tasks")
async def list_tasks() -> dict[str, Any]:
    return {"tasks": store.listed()}


@app.get("/api/tasks/{task_id}")
async def get_task(task_id: str) -> dict[str, Any]:
    return _task_or_404(task_id)


@app.post("/api/tasks")
async def create_task(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    venue = payload.get("venue") or {}
    if not (venue.get("name") or "").strip():
        raise HTTPException(status_code=422, detail="venue.name is required")

    request_block = payload.get("request") or {}
    task = {
        "id": store.new_task_id(),
        "created_at": store.now_iso(),
        "status": "queued",
        "venue": {
            "name": venue.get("name", "").strip(),
            "kind": (venue.get("kind") or "restaurant").strip(),
            "phone": (venue.get("phone") or "").strip(),
            "address": (venue.get("address") or "").strip(),
            "stay22_ref": venue.get("stay22_ref"),
        },
        "request": {
            "date": request_block.get("date"),
            "time": request_block.get("time"),
            "party_size": int(request_block.get("party_size") or 2),
            "asks": request_block.get("asks") or list(DEFAULT_ASKS),
        },
        "traveler": payload.get("traveler") or {"name": agents.traveler_name(), "notes": ""},
        "briefing": {"policy_brief": "", "sources": []},
        "conversation_id": None,
        "result": None,
        "transcript": [],
        "summary_markdown": None,
        "booking_link": payload.get("booking_link"),
    }
    store.put(task)

    # Pre-call brief, best effort, off the critical path.
    if providers.has_tavily():
        _spawn(_attach_brief(task["id"]))

    return task


async def _attach_brief(task_id: str) -> None:
    task = store.get(task_id)
    if task is None:
        return
    venue = task.get("venue") or {}
    address = venue.get("address") or ""
    city = address.split(",")[1].strip() if address.count(",") >= 1 else ""
    brief = await providers.tavily_brief(venue.get("name", ""), city)
    current = store.get(task_id)
    if current is not None:
        current["briefing"] = brief
        store.save()


@app.post("/api/tasks/{task_id}/call")
async def start_call(task_id: str) -> dict[str, Any]:
    """Fire the call and return immediately.

    Non-blocking by design: the presenter hits Call and keeps talking for
    ~25 seconds while the confirmation lands on screen mid-sentence. Nothing
    here may await telephony - the UI reflects state purely by polling.
    """
    task = _task_or_404(task_id)

    task["transcript"] = []
    task["result"] = None
    task["summary_markdown"] = None
    task["summary_source"] = None
    task["error"] = None
    task["status"] = "dialing"
    store.save()

    if agents.fake_call_mode():
        _spawn(agents.run_fake_call(task_id))
        return {"ok": True, "mode": "fake", "task_id": task_id, "status": "dialing"}

    _spawn(agents.run_live_call(task_id))
    return {"ok": True, "mode": "live", "task_id": task_id, "status": "dialing"}


@app.post("/api/tasks/{task_id}/simulate")
async def simulate(task_id: str) -> dict[str, Any]:
    """Demo insurance. Fills a realistic result instantly, no network.

    Not cheating - it is the thing that saves the demo if the venue network
    dies. Never shown on stage.
    """
    task = _task_or_404(task_id)
    canned = dict(agents.CANNED_RESULT)
    canned["name_on_reservation"] = (task.get("traveler") or {}).get("name") or agents.traveler_name()
    canned["party_size"] = (task.get("request") or {}).get("party_size") or 2
    agents.apply_reservation({"task_id": task_id, **canned})
    store.set_status(task_id, "completed")
    await _attach_summary(task_id)  # await, so the note is present in this response
    return _task_or_404(task_id)


# --------------------------------------------------------------------------
# Agent-facing webhooks
# --------------------------------------------------------------------------

@app.post("/api/agent/submit_reservation")
async def submit_reservation(
    request: Request,
    secret: str | None = Query(default=None),
) -> JSONResponse:
    """The agent's tool call, fired mid-conversation. This is the wow moment.

    Never 4xx a live agent: a rejected tool call is dead air on a call the room
    is listening to. Coerce whatever arrives and accept it.
    """
    _require_secret(secret)

    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        body = {}

    payload = agents.unwrap_tool_body(body)
    print(f"[reserve] keys={sorted(payload)}")

    # The note is written by post_reservation_hook, so it lands whichever
    # path produced the result.
    _, message = agents.apply_reservation(payload)
    return JSONResponse({"ok": True, "message": message})


@app.post("/api/webhooks/elevenlabs/post-call")
async def post_call(
    request: Request,
    secret: str | None = Query(default=None),
) -> dict[str, Any]:
    """Transcript + completion.

    Envelope verified against live docs: {type, event_timestamp, data{...}}.
    `type` is one of post_call_transcription | post_call_audio |
    call_initiation_failure, so branch rather than assuming a transcript.
    Inside a turn the fields are `role` ("agent"|"user"), `message`, and
    `time_in_call_secs` - not text/ts.
    """
    _require_secret(secret)

    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        return {"ok": False, "reason": "unparseable body"}

    event_type = body.get("type")
    data = body.get("data") or {}
    conversation_id = data.get("conversation_id")

    if event_type == "post_call_audio":
        return {"ok": True, "ignored": "audio"}

    task = next(
        (t for t in store.TASKS.values() if t.get("conversation_id") == conversation_id),
        None,
    )
    if task is None:
        in_flight = [t for t in store.TASKS.values() if t.get("status") in {"dialing", "in_progress"}]
        task = in_flight[0] if len(in_flight) == 1 else None
    if task is None:
        return {"ok": False, "reason": f"no task for conversation {conversation_id}"}

    if event_type == "call_initiation_failure":
        task["status"] = "failed"
        task["error"] = str(data.get("status") or "call initiation failed")
        store.save()
        return {"ok": True, "status": "failed"}

    turns = data.get("transcript") or []
    task["transcript"] = [
        {
            "role": "agent" if turn.get("role") == "agent" else "caller",
            "text": (turn.get("message") or "").strip(),
            "ts": float(turn.get("time_in_call_secs") or 0),
        }
        for turn in turns
        if (turn.get("message") or "").strip()
    ]
    task["status"] = "completed"
    store.save()

    # Backstop: the agent never called the tool, so extract from the transcript.
    if task.get("result") is None and providers.has_anthropic():
        _spawn(_backstop_extract(task["id"]))
    else:
        _spawn(_attach_summary(task["id"]))

    return {"ok": True, "task_id": task["id"], "turns": len(task["transcript"])}


async def _backstop_extract(task_id: str) -> None:
    """If the mid-call tool never fired, recover the card from the transcript.

    Weaker than the tool call - it is an LLM reading a transcript rather than
    the agent reporting what it confirmed - so it runs only as a fallback.
    """
    task = store.get(task_id)
    if task is None or not task.get("transcript"):
        return

    import anthropic

    schema = {
        "type": "object",
        "properties": {
            "reservation_confirmed": {"type": "boolean"},
            "confirmed_time": {"type": "string"},
            "party_size": {"type": "integer"},
            "name_on_reservation": {"type": "string"},
            "alternatives_offered": {"type": "array", "items": {"type": "string"}},
            "special_requests_status": {"type": "string"},
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
            "notes": {"type": "string"},
        },
        "required": ["reservation_confirmed", "confidence"],
        "additionalProperties": False,
    }
    lines = "\n".join(f"{turn['role']}: {turn['text']}" for turn in task["transcript"])

    try:
        client = anthropic.AsyncAnthropic()
        message = await client.with_options(timeout=10.0, max_retries=0).messages.create(
            model="claude-sonnet-5",
            max_tokens=1000,
            system=(
                "Extract only what the venue explicitly confirmed on this call. "
                "Never infer. Set confidence to low if anything was ambiguous."
            ),
            thinking={"type": "disabled"},
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
            messages=[{"role": "user", "content": lines}],
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[backstop] {type(exc).__name__}: {exc}")
        return

    if message.stop_reason == "refusal":
        return
    text = "".join(block.text for block in message.content if block.type == "text").strip()
    try:
        import json

        extracted = json.loads(text)
    except ValueError:
        print("[backstop] model returned unparseable JSON")
        return

    agents.apply_reservation({"task_id": task_id, **extracted})


# --------------------------------------------------------------------------
# Traveler-facing note
# --------------------------------------------------------------------------

async def _attach_summary(task_id: str) -> None:
    task = store.get(task_id)
    if task is None or not task.get("result"):
        return
    markdown, source = await providers.claude_note(task)
    current = store.get(task_id)
    if current is not None:
        current["summary_markdown"] = markdown
        current["summary_source"] = source
        store.save()


@app.post("/api/tasks/{task_id}/summarize")
async def summarize(task_id: str) -> dict[str, Any]:
    task = _task_or_404(task_id)
    if not task.get("result"):
        raise HTTPException(status_code=409, detail="no result to summarize yet")
    await _attach_summary(task_id)
    return _task_or_404(task_id)


# --------------------------------------------------------------------------
# Stay22 search - find where you're staying, then what's nearby
# --------------------------------------------------------------------------

@app.get("/api/search")
async def search(
    address: str = Query(...),
    checkin: str | None = Query(default=None),
    checkout: str | None = Query(default=None),
    adults: int = Query(default=2),
) -> dict[str, Any]:
    return await providers.stay22_search(address, checkin, checkout, adults)
