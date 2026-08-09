"""Call lifecycle: dynamic-variable injection, the ElevenLabs outbound trigger,
the reservation writer, and a scripted fake call for credential-free demos.

ElevenLabs request/response shapes verified against live docs on 2026-08-09.

The fake-call driver exists so the entire flow - status pills, streaming
transcript, mid-call confirmation - is buildable and demoable before a single
credential exists. It writes through `apply_reservation`, the same function
the real webhook calls, so exercising it exercises the real path.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import date, datetime
from pathlib import Path
from typing import Any

import httpx

import store

OUTBOUND_CALL_URL = "https://api.elevenlabs.io/v1/convai/twilio/outbound-call"

_REQUIRED_ELEVENLABS = (
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_AGENT_ID",
    "ELEVENLABS_AGENT_PHONE_NUMBER_ID",
    "DEMO_TO_NUMBER",
)


class CallError(RuntimeError):
    """Raised when a real outbound call cannot be placed."""


# Set by app.py at startup. Called with a task id whenever a reservation
# lands, so the traveler's note gets written no matter which path produced the
# result - the live tool webhook, the fake driver, Simulate, or the backstop.
post_reservation_hook: Any = None


def has_elevenlabs() -> bool:
    return all(os.environ.get(name, "").strip() for name in _REQUIRED_ELEVENLABS)


def fake_call_mode() -> bool:
    """Fake unless we have everything needed for a real call, or forced on."""
    if os.environ.get("CONCIERGE_FAKE_CALL", "").strip():
        return True
    return not has_elevenlabs()


def app_name() -> str:
    return os.environ.get("APP_NAME", "").strip() or "Roadio"


def traveler_name() -> str:
    return os.environ.get("TRAVELER_NAME", "").strip() or "the traveler"


def pretty_date(iso_date: str | None) -> str:
    if not iso_date:
        return "the requested date"
    try:
        parsed = date.fromisoformat(iso_date)
    except (ValueError, TypeError):
        return str(iso_date)
    # No %-d / %-B on Windows; build it by hand.
    return f"{parsed.strftime('%A')} {parsed.day} {parsed.strftime('%B')}"


def pretty_time(value: str | None) -> str:
    """'19:30' -> '7:30 PM'. Passed through unchanged if already spoken-form."""
    if not value:
        return "the requested time"
    text = str(value).strip()
    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            parsed = datetime.strptime(text, fmt)
        except ValueError:
            continue
        hour = parsed.hour % 12 or 12
        suffix = "AM" if parsed.hour < 12 else "PM"
        return f"{hour}:{parsed.minute:02d} {suffix}"
    return text


def build_dynamic_variables(task: dict[str, Any]) -> dict[str, str]:
    """Everything the agent needs, pre-injected.

    Pre-inject rather than fetch mid-call: a mid-call read adds latency the
    room hears as silence, and a failure surface we cannot control. Tools are
    for writes only.
    """
    venue = task.get("venue") or {}
    request = task.get("request") or {}
    briefing = task.get("briefing") or {}

    asks = request.get("asks") or []
    asks_list = "\n".join(f"- {ask}" for ask in asks) if asks else "- confirm the booking"

    brief = (briefing.get("policy_brief") or "").strip()
    if not brief:
        brief = "Nothing on file. Ask about anything you need."

    return {
        "task_id": str(task.get("id", "")),
        "app_name": app_name(),
        "traveler_name": (task.get("traveler") or {}).get("name") or traveler_name(),
        "venue_name": venue.get("name") or "the venue",
        "date_pretty": pretty_date(request.get("date")),
        "time_pretty": pretty_time(request.get("time")),
        "party_size": str(request.get("party_size") or 2),
        "asks_list": asks_list,
        "policy_brief": brief,
    }


# --------------------------------------------------------------------------
# Writing reservation results
# --------------------------------------------------------------------------

_TRUTHY = {"true", "yes", "y", "1", "confirmed", "booked", "available"}
_FALSY = {"false", "no", "n", "0", "unavailable", "declined", "none"}


def _as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in _TRUTHY:
            return True
        if lowered in _FALSY:
            return False
    return None


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        digits = "".join(ch for ch in value if ch.isdigit())
        try:
            return int(digits) if digits else None
        except ValueError:
            return None
    return None


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [part.strip() for part in value.split(",") if part.strip()]
    return []


def unwrap_tool_body(body: Any) -> dict[str, Any]:
    """Accept either a flat body or a {"parameters": {...}} envelope.

    ElevenLabs' webhook-tool request shape is genuinely undocumented - their
    own docs describe the tool as an HTTP request builder whose declared
    properties become the body, which implies flat, but no verbatim example
    exists. Rather than guess, accept both. Confirm the real shape once against
    a webhook.site bin and this stays correct either way.
    """
    if not isinstance(body, dict):
        return {}
    for envelope_key in ("parameters", "arguments", "body", "input"):
        nested = body.get(envelope_key)
        if isinstance(nested, dict) and nested:
            merged = {k: v for k, v in body.items() if k != envelope_key}
            merged.update(nested)
            return merged
    return body


def apply_reservation(payload: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    """Coerce a reservation payload onto a task. Never raises on bad input.

    Returns (task, message). The message is what the agent speaks back.

    This endpoint is called by a live voice agent mid-conversation. A 4xx or an
    exception here becomes an awkward silence on a call the room is listening
    to, so we coerce whatever we got and accept it. This leniency is scoped to
    this one function by design.
    """
    task_id = str(payload.get("task_id") or "").strip()

    # doctor.py probes this endpoint through the tunnel. Without this guard the
    # in-flight fallback below would attribute the probe to a real call and
    # wipe its result.
    if task_id == "__preflight__":
        return None, "Preflight acknowledged."

    task = store.get(task_id)
    if task is None:
        # Fall back to the only in-flight call, if there is exactly one. A
        # hallucinated task_id shouldn't lose a real booking mid-demo.
        in_flight = [t for t in store.TASKS.values() if t.get("status") in {"dialing", "in_progress"}]
        if len(in_flight) == 1:
            task = in_flight[0]
            print(f"[reserve] unknown task_id {task_id!r}; attributed to in-flight {task['id']}")
        else:
            print(f"[reserve] unknown task_id {task_id!r} and {len(in_flight)} in flight; dropping")
            return None, "Thanks, I've noted that."

    request = task.get("request") or {}
    result: dict[str, Any] = {
        "reservation_confirmed": _as_bool(payload.get("reservation_confirmed")),
        "confirmed_time": str(payload.get("confirmed_time") or "").strip(),
        "party_size": _as_int(payload.get("party_size")) or request.get("party_size"),
        "name_on_reservation": str(payload.get("name_on_reservation") or "").strip(),
        "confirmation_code": str(payload.get("confirmation_code") or "").strip(),
        "price": str(payload.get("price") or "").strip(),
        "check_in": str(payload.get("check_in") or "").strip(),
        "alternatives_offered": _as_list(payload.get("alternatives_offered")),
        "special_requests_status": str(payload.get("special_requests_status") or "").strip(),
        "confidence": str(payload.get("confidence") or "medium").strip().lower(),
        "notes": str(payload.get("notes") or "").strip(),
    }
    # What we asked for, so the card can show "asked 10:00 AM -> booked 7:00 PM".
    result["requested_time"] = pretty_time(request.get("time"))
    if result["confidence"] not in {"high", "medium", "low"}:
        result["confidence"] = "medium"

    task["result"] = result
    task["result_at"] = store.now_iso()
    store.save()

    if post_reservation_hook is not None:
        post_reservation_hook(task["id"])

    return task, "Great, I've got that logged. Thank you!"


# --------------------------------------------------------------------------
# The real outbound call
# --------------------------------------------------------------------------

AGENT_DIR = Path(__file__).resolve().parent / "agent"


def render_agent_text(filename: str, variables: dict[str, str]) -> str:
    """Read agent/<file> and substitute {{var}} with the call's real values."""
    try:
        text = (AGENT_DIR / filename).read_text(encoding="utf-8").lstrip("﻿")
    except OSError as exc:
        print(f"[agent] could not read {filename}: {exc}")
        return ""
    for name, value in variables.items():
        text = text.replace("{{" + name + "}}", value)
    return text.strip()


def _override_block(variables: dict[str, str]) -> dict[str, Any] | None:
    """A fully-resolved prompt to send with the call.

    The agent's dashboard prompt is a config we do not control from here, and
    when it drifts the symptom is an agent that opens the call not knowing the
    date, time or party size and has to ask for everything. Sending the
    resolved prompt with the call makes the dashboard copy irrelevant.

    Requires "overrides" to be enabled on the agent; place_call falls back to
    calling without this block if ElevenLabs rejects it.
    """
    system = render_agent_text("system-prompt.txt", variables)
    first = render_agent_text("first-message.txt", variables)
    if not system and not first:
        return None
    agent_block: dict[str, Any] = {}
    if system:
        agent_block["prompt"] = {"prompt": system}
    if first:
        agent_block["first_message"] = first
    return {"agent": agent_block}


async def place_call(task: dict[str, Any]) -> dict[str, Any]:
    """Trigger an ElevenLabs outbound call over the imported Twilio number.

    Field names verified against the live API reference. `conversation_id` and
    `callSid` are both nullable in the response, so success is gated on the
    `success` flag, not on their presence.
    """
    if not has_elevenlabs():
        missing = [name for name in _REQUIRED_ELEVENLABS if not os.environ.get(name, "").strip()]
        raise CallError(f"missing env: {', '.join(missing)}")

    variables = build_dynamic_variables(task)

    # Safety rail: every demo call goes to DEMO_TO_NUMBER and nowhere else.
    # A venue's real phone number is stored on the task for display only and is
    # never dialled - there is deliberately no code path from it to here.
    destination = os.environ["DEMO_TO_NUMBER"].strip()

    initiation: dict[str, Any] = {"dynamic_variables": variables}
    if (override := _override_block(variables)) is not None:
        initiation["conversation_config_override"] = override

    body = {
        "agent_id": os.environ["ELEVENLABS_AGENT_ID"].strip(),
        "agent_phone_number_id": os.environ["ELEVENLABS_AGENT_PHONE_NUMBER_ID"].strip(),
        "to_number": destination,
        "conversation_initiation_client_data": initiation,
    }

    headers = {"xi-api-key": os.environ["ELEVENLABS_API_KEY"].strip()}
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(OUTBOUND_CALL_URL, headers=headers, json=body)

        # Overrides have to be enabled on the agent. If they aren't, retry
        # without them rather than losing the call - a call driven by the
        # dashboard prompt still beats no call at all.
        if response.status_code >= 400 and "conversation_config_override" in initiation:
            print(f"[call] override rejected ({response.status_code}); retrying without it. "
                  f"Enable overrides on the agent so it knows the booking details.")
            initiation.pop("conversation_config_override")
            body["conversation_initiation_client_data"] = initiation
            response = await client.post(OUTBOUND_CALL_URL, headers=headers, json=body)

    if response.status_code >= 400:
        raise CallError(f"ElevenLabs {response.status_code}: {response.text[:400]}")

    payload = response.json()
    if not payload.get("success", False):
        raise CallError(f"ElevenLabs declined the call: {payload.get('message') or payload}")

    return {
        "conversation_id": payload.get("conversation_id"),
        "call_sid": payload.get("callSid"),
        "message": payload.get("message"),
    }


CONVERSATION_URL = "https://api.elevenlabs.io/v1/convai/conversations/{conversation_id}"


async def fetch_conversation(conversation_id: str) -> dict[str, Any] | None:
    """Read a conversation back from ElevenLabs.

    This is the reason the module still works with no public tunnel: when the
    webhooks cannot reach us, ElevenLabs still holds the transcript and the
    agent's tool calls. Pulling beats waiting to be pushed to.
    """
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key or not conversation_id:
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                CONVERSATION_URL.format(conversation_id=conversation_id),
                headers={"xi-api-key": key},
            )
        if response.status_code != 200:
            print(f"[poll] conversation {conversation_id} -> HTTP {response.status_code}")
            return None
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        print(f"[poll] {type(exc).__name__}: {exc}")
        return None


def transcript_from_conversation(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Map ElevenLabs turns onto our shape.

    Their fields are role/message/time_in_call_secs, and role is agent|user -
    not text/ts and not agent|caller.
    """
    turns = []
    for turn in data.get("transcript") or []:
        text = (turn.get("message") or "").strip()
        if not text:
            continue
        turns.append({
            "role": "agent" if turn.get("role") == "agent" else "caller",
            "text": text,
            "ts": float(turn.get("time_in_call_secs") or 0),
        })
    return turns


def reservation_from_conversation(data: dict[str, Any]) -> dict[str, Any] | None:
    """Recover the agent's submit_reservation arguments from the transcript.

    When the tool webhook could not be delivered, the call the agent *made* is
    still recorded. Its parameters are the same payload the webhook would have
    carried, so we can fill the card from them.
    """
    for turn in data.get("transcript") or []:
        for call in turn.get("tool_calls") or []:
            if call.get("tool_name") != "submit_reservation":
                continue
            params = call.get("params_as_json")
            if isinstance(params, dict):
                return params
            if isinstance(params, str):
                try:
                    parsed = json.loads(params)
                except ValueError:
                    continue
                if isinstance(parsed, dict):
                    return parsed
    return None


async def sync_from_elevenlabs(task_id: str) -> bool:
    """Pull one snapshot of a call into the task. Returns True when it settled."""
    task = store.get(task_id)
    if task is None:
        return True
    conversation_id = str(task.get("conversation_id") or "")
    data = await fetch_conversation(conversation_id)
    if data is None:
        return False

    turns = transcript_from_conversation(data)
    current = store.get(task_id)
    if current is None:
        return True
    if turns and turns != current.get("transcript"):
        current["transcript"] = turns
        store.save()

    if (payload := reservation_from_conversation(data)) is not None and current.get("result") is None:
        apply_reservation({**payload, "task_id": task_id})

    status = data.get("status")
    if status in {"done", "failed"}:
        settled = store.get(task_id)
        if settled is not None and settled.get("status") not in {"completed", "failed"}:
            settled["status"] = "completed"
            store.save()
        return True
    return False


async def watch_live_call(task_id: str, poll_seconds: float = 4.0, max_seconds: float = 900.0) -> None:
    """Poll ElevenLabs until the call ends, mirroring it into the task.

    Without this, a live call with no reachable post-call webhook sits in
    `in_progress` forever - the card never fills and the button stays disabled,
    so the task cannot even be re-dialled. The webhook is still the fast path
    when a tunnel exists; this is what makes the tunnel optional.
    """
    waited = 0.0
    while waited < max_seconds:
        await asyncio.sleep(poll_seconds)
        waited += poll_seconds
        try:
            if await sync_from_elevenlabs(task_id):
                return
        except Exception as exc:  # noqa: BLE001 - a poll must never kill the call
            print(f"[poll] {type(exc).__name__}: {exc}")

    print(f"[poll] gave up on {task_id} after {max_seconds:.0f}s")
    stuck = store.get(task_id)
    if stuck is not None and stuck.get("status") in {"dialing", "in_progress"}:
        stuck["status"] = "failed"
        stuck["error"] = "call did not report a result in time"
        store.save()


async def run_live_call(task_id: str) -> None:
    """Place a real call in the background.

    POST /call must return immediately - the presenter hits Call and keeps
    talking, and the UI catches up by polling. Awaiting ElevenLabs inline
    would stall the response for up to 20 seconds with the room watching.
    """
    task = store.get(task_id)
    if task is None:
        return
    try:
        outcome = await place_call(task)
    except (CallError, httpx.HTTPError) as exc:
        current = store.get(task_id)
        if current is not None:
            current["status"] = "failed"
            current["error"] = str(exc)
            store.save()
        print(f"[call] failed for {task_id}: {exc}")
        return

    current = store.get(task_id)
    if current is not None:
        current["conversation_id"] = outcome["conversation_id"]
        current["call_sid"] = outcome["call_sid"]
        current["status"] = "in_progress"
        store.save()

    # Mirror the call from ElevenLabs as it runs. The webhooks are the fast
    # path when a tunnel exists; this is the safety net when one doesn't, and
    # it is what stops a task sticking in `in_progress` forever.
    await watch_live_call(task_id)


# --------------------------------------------------------------------------
# The scripted fake call
# --------------------------------------------------------------------------

_LEAD_IN = 2.5

# Paced so the tool call lands ~25s after the presenter hits Call: they fire
# it, keep talking, and the confirmation appears mid-sentence.
_FAKE_SCRIPT: list[tuple[float, str, str]] = [
    (0.0, "agent", "Hi, this is Iris, an AI assistant calling on behalf of {traveler}. I'm hoping to make a reservation for {party} on {date} — do you have a quick moment?"),
    (3.5, "caller", "Of course, let me pull up the book."),
    (5.0, "agent", "Thank you. We were hoping for around {time}."),
    (7.5, "caller", "Let's see... {time} is fully committed, I'm afraid."),
    (10.0, "agent", "No problem at all. What do you have available that evening?"),
    (12.5, "caller", "I could do seven fifteen, or eight forty-five."),
    (15.0, "agent", "Eight forty-five would be lovely, thank you."),
    (17.0, "caller", "Wonderful. And the name for the booking?"),
    (18.5, "agent", "It's under {traveler}."),
    (20.5, "caller", "Got it. Table for {party} at eight forty-five."),
    (23.5, "agent", "Perfect. One more thing — is there any chance of a table outside?"),
    (26.0, "caller", "I've noted a preference for the terrace. Weather permitting."),
    (28.5, "agent", "Wonderful. Anything we should know before arriving?"),
    (30.5, "caller", "Just come five minutes early, and we hold tables fifteen minutes."),
    (33.0, "agent", "Understood. Thank you so much for your help."),
    (35.5, "caller", "My pleasure. See you then."),
    (37.5, "agent", "See you then. Goodbye."),
]

# Fires with six turns still to come, so the confirmation visibly lands while
# the room can still hear talking. That simultaneity is the whole demo - if it
# lands after the last line, the moment is gone.
# 22.5 script + 2.5 lead-in = ~25s after the presenter hits Call.
_FAKE_RESULT_AT = 22.5

CANNED_RESULT: dict[str, Any] = {
    "reservation_confirmed": True,
    "confirmed_time": "8:45 PM",
    "party_size": 2,
    "name_on_reservation": "{traveler}",
    "confirmation_code": "2146",
    "price": "$120 total",
    "check_in": "Main entrance on the terrace side",
    "alternatives_offered": ["7:15 PM", "8:45 PM"],
    "special_requests_status": "Terrace table noted, weather permitting",
    "confidence": "high",
    "notes": "Arrive five minutes early. They hold tables for fifteen minutes.",
}


def _speed() -> float:
    """FAKE_CALL_SPEED=4 makes a 55s scripted call take ~14s while developing."""
    try:
        value = float(os.environ.get("FAKE_CALL_SPEED", "1") or "1")
    except ValueError:
        return 1.0
    return value if value > 0 else 1.0


async def run_fake_call(task_id: str) -> None:
    """Walk a task through a realistic call without any telephony.

    Writes through `apply_reservation`, so the card fills by the same route a
    real agent tool call would use.
    """
    speed = _speed()
    task = store.get(task_id)
    if task is None:
        return

    variables = build_dynamic_variables(task)
    substitutions = {
        "traveler": variables["traveler_name"],
        "party": variables["party_size"],
        "date": variables["date_pretty"],
        "time": variables["time_pretty"],
        "venue": variables["venue_name"],
    }
    canned = dict(CANNED_RESULT)
    canned["name_on_reservation"] = variables["traveler_name"]
    canned["party_size"] = (task.get("request") or {}).get("party_size") or 2

    # Merge the tool call into the timeline so it fires mid-conversation
    # rather than after the last line.
    timeline: list[tuple[float, str, str | None]] = list(_FAKE_SCRIPT)
    timeline.append((_FAKE_RESULT_AT, "__tool__", None))
    timeline.sort(key=lambda item: item[0])

    try:
        await asyncio.sleep(_LEAD_IN / speed)
        store.set_status(task_id, "in_progress")

        elapsed = 0.0
        for at, role, template in timeline:
            await asyncio.sleep(max(0.0, at - elapsed) / speed)
            elapsed = at
            if role == "__tool__":
                apply_reservation({"task_id": task_id, **canned})
            else:
                store.append_transcript(task_id, role, (template or "").format(**substitutions), at)

        await asyncio.sleep(2.0 / speed)
        store.set_status(task_id, "completed")
    except asyncio.CancelledError:
        store.set_status(task_id, "failed")
        raise
