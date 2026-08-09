r"""Preflight check. Run this before trusting a live call.

    .\venv\Scripts\python.exe doctor.py

Checks the chain in the order it breaks in practice. The tunnel hop is the one
that actually bites: a call can sound perfect while the card stays empty
because ElevenLabs could not reach this laptop.

Exit code 0 = ready to call. 1 = something would fail.
"""

from __future__ import annotations

import asyncio
import os
import re
import sys

import httpx
from dotenv import load_dotenv

load_dotenv()

LOCAL = "http://127.0.0.1:8000"

_PASS, _FAIL, _WARN = "PASS", "FAIL", "WARN"
_results: list[tuple[str, str, str]] = []


def record(level: str, label: str, detail: str = "") -> None:
    _results.append((level, label, detail))
    mark = {"PASS": "[ ok ]", "FAIL": "[FAIL]", "WARN": "[warn]"}[level]
    print(f"{mark} {label}" + (f"\n       {detail}" if detail else ""))


def env(name: str) -> str:
    return os.environ.get(name, "").strip()


async def main() -> int:
    print("\n--- concierge-line preflight ---\n")

    # 1. Environment ------------------------------------------------------
    required = [
        "ELEVENLABS_API_KEY",
        "ELEVENLABS_AGENT_ID",
        "ELEVENLABS_AGENT_PHONE_NUMBER_ID",
        "DEMO_TO_NUMBER",
        "PUBLIC_BASE_URL",
    ]
    missing = [name for name in required if not env(name)]
    if missing:
        record(_FAIL, "environment", f"missing: {', '.join(missing)}")
    else:
        record(_PASS, "environment", "all five telephony variables present")

    to_number = env("DEMO_TO_NUMBER")
    if to_number and not re.fullmatch(r"\+[1-9]\d{7,14}", to_number):
        record(_FAIL, "DEMO_TO_NUMBER format",
               f"{to_number!r} is not E.164 — it must look like +12125551234")
    elif to_number:
        record(_PASS, "DEMO_TO_NUMBER format", to_number)

    base = env("PUBLIC_BASE_URL")
    if base.endswith("/"):
        record(_WARN, "PUBLIC_BASE_URL", "has a trailing slash; webhook URLs will contain //")
    if base and not base.startswith("https://"):
        record(_WARN, "PUBLIC_BASE_URL", "is not https — ElevenLabs webhooks expect https")

    if not env("ELEVENLABS_WEBHOOK_SECRET"):
        record(_WARN, "webhook secret",
               "unset, so the public webhook routes are unauthenticated. Fine for a demo; "
               "set one if the tunnel is up for long.")

    # 2. Local server -----------------------------------------------------
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            local = await client.get(f"{LOCAL}/api/health")
            health = local.json()
            record(_PASS, "local server", f"{LOCAL} responding, {health['tasks']} tasks loaded")
            if health["fake_call_mode"]:
                record(_WARN, "call mode",
                       "FAKE — /call will run the scripted demo, not dial out. "
                       "Unset CONCIERGE_FAKE_CALL and restart once credentials are in.")
            else:
                record(_PASS, "call mode", "LIVE — /call will dial out")
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            record(_FAIL, "local server", f"{LOCAL} not responding ({type(exc).__name__}). Start uvicorn.")
            return report()

        # 3. The tunnel — the hop that actually breaks --------------------
        if not base:
            record(_FAIL, "public tunnel", "PUBLIC_BASE_URL unset; ElevenLabs cannot reach this laptop")
        else:
            try:
                through = await client.get(f"{base.rstrip('/')}/api/health")
                if through.status_code != 200:
                    record(_FAIL, "public tunnel", f"{base} returned HTTP {through.status_code}")
                elif through.json().get("ok") is not True:
                    record(_FAIL, "public tunnel", f"{base} answered, but not with our app")
                else:
                    record(_PASS, "public tunnel", f"{base} reaches this server")
            except httpx.HTTPError as exc:
                record(_FAIL, "public tunnel",
                       f"{base} unreachable ({type(exc).__name__}). Is ngrok running on port 8000?")

            # 4. Webhook round-trip, exactly as the agent will call it -----
            secret = env("ELEVENLABS_WEBHOOK_SECRET")
            url = f"{base.rstrip('/')}/api/agent/submit_reservation"
            if secret:
                url += f"?secret={secret}"
            try:
                probe = await client.post(url, json={"task_id": "__preflight__"})
                if probe.status_code == 200 and probe.json().get("ok"):
                    record(_PASS, "webhook round-trip",
                           "the agent's tool call will reach us and be accepted")
                elif probe.status_code == 403:
                    record(_FAIL, "webhook round-trip",
                           "403 — the secret in the tool URL must match ELEVENLABS_WEBHOOK_SECRET")
                else:
                    record(_FAIL, "webhook round-trip", f"HTTP {probe.status_code}: {probe.text[:160]}")
            except httpx.HTTPError as exc:
                record(_FAIL, "webhook round-trip", f"{type(exc).__name__}: {exc}")

        # 5. ElevenLabs credentials ---------------------------------------
        key = env("ELEVENLABS_API_KEY")
        agent_id = env("ELEVENLABS_AGENT_ID")
        if key and agent_id:
            try:
                probe = await client.get(
                    f"https://api.elevenlabs.io/v1/convai/agents/{agent_id}",
                    headers={"xi-api-key": key},
                )
                if probe.status_code == 200:
                    record(_PASS, "ElevenLabs agent", "API key valid and agent id resolves")
                elif probe.status_code == 401:
                    record(_FAIL, "ElevenLabs agent", "401 — ELEVENLABS_API_KEY is wrong")
                elif probe.status_code == 404:
                    record(_FAIL, "ElevenLabs agent", f"404 — no agent {agent_id}")
                else:
                    record(_WARN, "ElevenLabs agent",
                           f"probe returned HTTP {probe.status_code}. This endpoint is not one I "
                           f"verified against docs, so treat it as inconclusive rather than broken.")
            except httpx.HTTPError as exc:
                record(_WARN, "ElevenLabs agent", f"probe failed ({type(exc).__name__}); inconclusive")

        # 6. Anthropic (optional) -----------------------------------------
        import providers

        if providers.has_anthropic():
            record(_PASS, "Anthropic", "credentials found; notes will be written by Claude")
        else:
            record(_WARN, "Anthropic",
                   "no credentials — notes fall back to the deterministic template. Not a blocker.")

    return report()


def report() -> int:
    fails = [r for r in _results if r[0] == _FAIL]
    warns = [r for r in _results if r[0] == _WARN]
    print("\n" + "-" * 52)
    if fails:
        print(f"NOT READY — {len(fails)} blocking issue(s):")
        for _, label, detail in fails:
            print(f"  - {label}: {detail}")
        print("\nThe scripted demo still works regardless: hit Call in fake mode.")
        return 1
    print(f"READY TO CALL{f'  ({len(warns)} warning(s))' if warns else ''}")
    print("\nNext: POST a call and listen.")
    print('  Invoke-RestMethod -Method Post "http://127.0.0.1:8000/api/tasks/t_seed03/call"')
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
