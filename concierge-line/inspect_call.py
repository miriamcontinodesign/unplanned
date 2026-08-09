r"""Fetch what ElevenLabs recorded for a conversation.

    .\venv\Scripts\python.exe inspect_call.py [conversation_id]

With no argument it inspects the most recent conversation on the agent. This
is the diagnostic that works *without* ngrok: when the post-call webhook can't
reach us, ElevenLabs still holds the transcript, the termination reason, and
whether the agent ever called its tool. Pull it rather than guess.

Prints no secrets.
"""

from __future__ import annotations

import os
import sys
import time

import httpx

import config  # noqa: F401  - loads .env from this folder

API = "https://api.elevenlabs.io/v1/convai"


def main() -> int:
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    agent_id = os.environ.get("ELEVENLABS_AGENT_ID", "").strip()
    if not key:
        print("ELEVENLABS_API_KEY is not set")
        return 1

    headers = {"xi-api-key": key}
    conversation_id = sys.argv[1] if len(sys.argv) > 1 else None

    with httpx.Client(timeout=20.0, headers=headers) as client:
        if conversation_id is None:
            listing = client.get(f"{API}/conversations", params={"agent_id": agent_id, "page_size": 5})
            if listing.status_code != 200:
                print(f"list conversations -> HTTP {listing.status_code}: {listing.text[:300]}")
                return 1
            items = listing.json().get("conversations", [])
            if not items:
                print("no conversations recorded for this agent yet")
                return 1
            print(f"most recent {len(items)} conversation(s) on this agent:\n")
            for item in items:
                print(f"  {item.get('conversation_id')}  "
                      f"status={item.get('status')}  "
                      f"secs={item.get('call_duration_secs')}  "
                      f"messages={item.get('message_count')}  "
                      f"successful={item.get('call_successful')}")
            conversation_id = items[0].get("conversation_id")
            print(f"\n--- detail for {conversation_id} ---\n")

        # --wait polls until the call ends, so you can run this the moment you
        # dial and read the whole record when the handset goes down.
        wait = "--wait" in sys.argv
        deadline = 300
        waited = 0
        while True:
            detail = client.get(f"{API}/conversations/{conversation_id}")
            if detail.status_code != 200:
                print(f"HTTP {detail.status_code}: {detail.text[:400]}")
                return 1
            data = detail.json()
            if not wait or data.get("status") != "in-progress" or waited >= deadline:
                break
            time.sleep(5)
            waited += 5
            print(f"  ...still on the call ({waited}s)")

    meta = data.get("metadata") or {}
    analysis = data.get("analysis") or {}
    print(f"status              : {data.get('status')}")
    print(f"call_successful     : {analysis.get('call_successful')}")
    print(f"duration_secs       : {meta.get('call_duration_secs')}")
    print(f"termination_reason  : {meta.get('termination_reason')!r}")
    if error := meta.get("error"):
        print(f"error               : {error!r}")

    phone = meta.get("phone_call") or {}
    if phone:
        print(f"phone direction     : {phone.get('direction')}")
        print(f"phone status        : {phone.get('status')}")

    transcript = data.get("transcript") or []
    print(f"\ntranscript ({len(transcript)} turns):")
    if not transcript:
        print("  (empty - the agent never spoke, or the callee never connected)")
    for turn in transcript:
        role = turn.get("role")
        message = (turn.get("message") or "").strip()
        secs = turn.get("time_in_call_secs")
        if message:
            print(f"  [{secs:>3}s] {role}: {message}")
        for call_ in turn.get("tool_calls") or []:
            print(f"         >> TOOL CALL: {call_.get('tool_name')} params={call_.get('params_as_json')}")
        for result in turn.get("tool_results") or []:
            print(f"         << TOOL RESULT: {result.get('tool_name')} "
                  f"error={result.get('is_error')} result={str(result.get('result_value'))[:200]}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
