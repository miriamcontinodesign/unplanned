r"""Dump the ElevenLabs agent's live configuration.

    .\venv\Scripts\python.exe inspect_agent.py

Shows the prompt, first message, the variables the prompt actually references,
and any registered tools with their URLs. Prints no secrets: header values and
anything key-shaped is redacted.

The point is to compare what the agent expects against what we send. A prompt
that references a variable we do not supply, or a tool pointing at an
unreachable URL, both look like the agent going silent mid-call.
"""

from __future__ import annotations

import os
import re
import sys

import httpx

import config  # noqa: F401  - loads .env from this folder

import agents


def redact(value: object) -> str:
    text = str(value)
    return re.sub(r"(sk-|xi-|whsec_)[A-Za-z0-9_\-]{6,}", r"\1<redacted>", text)


def main() -> int:
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    agent_id = os.environ.get("ELEVENLABS_AGENT_ID", "").strip()
    if not key or not agent_id:
        print("ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID not set")
        return 1

    with httpx.Client(timeout=20.0, headers={"xi-api-key": key}) as client:
        response = client.get(f"https://api.elevenlabs.io/v1/convai/agents/{agent_id}")
    if response.status_code != 200:
        print(f"HTTP {response.status_code}: {response.text[:300]}")
        return 1
    data = response.json()

    conv = (data.get("conversation_config") or {})
    agent_cfg = conv.get("agent") or {}
    prompt_cfg = agent_cfg.get("prompt") or {}
    prompt_text = prompt_cfg.get("prompt") or ""
    first = agent_cfg.get("first_message") or ""

    print(f"agent name : {data.get('name')}")
    print(f"language   : {agent_cfg.get('language')}")
    print(f"llm        : {prompt_cfg.get('llm')}")
    print()
    print("FIRST MESSAGE:")
    print(" ", first or "(empty)")
    print()
    print(f"PROMPT ({len(prompt_text)} chars):")
    for line in prompt_text.splitlines()[:40]:
        print("  " + line)
    if len(prompt_text.splitlines()) > 40:
        print(f"  ... +{len(prompt_text.splitlines()) - 40} more lines")
    print()

    # Which variables does the agent reference, and do we send them?
    referenced = set(re.findall(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}", prompt_text + " " + first))
    sample = agents.build_dynamic_variables({
        "id": "t_x", "venue": {"name": "V"}, "request": {}, "traveler": {}, "briefing": {},
    })
    provided = set(sample)
    print(f"variables the agent references : {sorted(referenced) or 'none'}")
    print(f"variables we send              : {sorted(provided)}")
    missing = sorted(referenced - provided)
    print(f"REFERENCED BUT NOT SENT        : {missing or 'none'}"
          + ("   <-- these render empty and can derail the agent" if missing else ""))
    print()

    # Tools: a webhook pointing somewhere unreachable stalls the whole turn.
    tool_ids = prompt_cfg.get("tool_ids") or []
    tools = prompt_cfg.get("tools") or []
    print(f"tools attached : {len(tools) or len(tool_ids) or 0}")
    for tool in tools:
        api = tool.get("api_schema") or {}
        print(f"  - {tool.get('name')} ({tool.get('type')})")
        if api:
            print(f"      {api.get('method', 'POST')} {redact(api.get('url'))}")
    for tid in tool_ids:
        print(f"  - tool_id {tid}")
        with httpx.Client(timeout=20.0, headers={"xi-api-key": key}) as client:
            detail = client.get(f"https://api.elevenlabs.io/v1/convai/tools/{tid}")
        if detail.status_code == 200:
            spec = (detail.json().get("tool_config") or {})
            api = spec.get("api_schema") or {}
            print(f"      name: {spec.get('name')}")
            if api:
                print(f"      {api.get('method', 'POST')} {redact(api.get('url'))}")
        else:
            print(f"      (could not read: HTTP {detail.status_code})")

    overrides = ((conv.get("agent") or {}).get("prompt") or {})
    privacy = data.get("platform_settings") or {}
    ov = (privacy.get("overrides") or {})
    if ov:
        print()
        print(f"overrides config : {ov}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
