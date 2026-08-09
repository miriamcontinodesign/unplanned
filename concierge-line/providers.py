"""External API clients. Every one of these degrades to something useful when
its credential is absent, because the demo must survive a dead network.

API shapes here were verified against live docs on 2026-08-09. Two corrections
against the PRD's guesses are marked CORRECTED below - don't "fix" them back.
"""

from __future__ import annotations

import os
from datetime import date
from pathlib import Path
from typing import Any

import httpx

import config  # noqa: F401  - same reason as agents.py: don't depend on the entry point
from store import TTLCache

STAY22_URL = "https://api.stay22.com/v2/accommodations"
TAVILY_URL = "https://api.tavily.com/search"

_search_cache = TTLCache(ttl_seconds=600.0)


def has_anthropic() -> bool:
    """True if the SDK will find credentials.

    Not just the env var: a zero-arg `Anthropic()` also resolves an
    `ant auth login` profile on disk, so checking only ANTHROPIC_API_KEY
    would skip Claude on a machine that is perfectly well authenticated.
    """
    if os.environ.get("ANTHROPIC_API_KEY", "").strip():
        return True
    if os.environ.get("ANTHROPIC_AUTH_TOKEN", "").strip():
        return True
    if appdata := os.environ.get("APPDATA"):
        if (Path(appdata) / "Anthropic" / "credentials").is_dir():
            return True
    return (Path.home() / ".config" / "anthropic" / "credentials").is_dir()


def has_tavily() -> bool:
    return bool(os.environ.get("TAVILY_API_KEY", "").strip())


# --------------------------------------------------------------------------
# Stay22 - live inventory + the commissionable booking link
# --------------------------------------------------------------------------

def _map_stay22_result(item: dict[str, Any]) -> dict[str, Any]:
    """Flatten one Stay22 result into what the dashboard needs.

    CORRECTED vs the PRD: name/address/rating are nested, not flat, and
    `suppliers` is a SPARSE map - not every property returns every supplier -
    so iterate its keys instead of hardcoding booking/expedia/hotelscom/vrbo.
    """
    location = item.get("location") or {}
    coords = location.get("coordinates") or {}
    rating = item.get("rating") or {}
    media = item.get("media") or {}

    best_price: float | None = None
    best_link: str | None = None
    for supplier in (item.get("suppliers") or {}).values():
        if not isinstance(supplier, dict):
            continue
        total = (supplier.get("price") or {}).get("total")
        if not isinstance(total, (int, float)):
            continue
        if best_price is None or total < best_price:
            best_price = float(total)
            best_link = supplier.get("link")

    return {
        "stay22_ref": item.get("id"),
        "name": item.get("name") or "Unnamed property",
        "address": location.get("address"),
        "lat": coords.get("lat"),
        "lng": coords.get("lng"),
        "rating": rating.get("value"),
        "stars": rating.get("hotelStars"),
        "thumbnail": media.get("thumbnail"),
        "best_price": best_price,
        "best_link": best_link,
    }


async def stay22_search(
    address: str,
    checkin: str | None,
    checkout: str | None,
    adults: int,
) -> dict[str, Any]:
    """Proxy Stay22 with a 10-minute in-memory cache.

    Results are never written to disk - Stay22's terms forbid cold-storing
    listings. On 429 we serve the stale cache rather than failing the UI.
    """
    params: dict[str, Any] = {
        "address": address,
        "adults": adults,
        "rooms": 1,
        "type": "hotel",
        "pageSize": 8,
    }
    # Prices and min/max filters only apply when BOTH dates are present.
    if checkin and checkout:
        params["checkin"] = checkin
        params["checkout"] = checkout

    key = repr(sorted(params.items()))
    cached = _search_cache.get(key)
    if cached is not None:
        return {"results": cached, "cached": True, "stale": False}

    headers = {}
    api_key = os.environ.get("STAY22_API_KEY", "").strip()
    if api_key:
        headers["X-API-KEY"] = api_key

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(STAY22_URL, params=params, headers=headers)
        if response.status_code == 429:
            stale = _search_cache.get_stale(key)
            print("[stay22] 429 rate limited; serving stale cache" if stale else "[stay22] 429 and no cache")
            return {"results": stale or [], "cached": bool(stale), "stale": True}
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        stale = _search_cache.get_stale(key)
        print(f"[stay22] {type(exc).__name__}: {exc}")
        return {"results": stale or [], "cached": bool(stale), "stale": True}

    mapped = [_map_stay22_result(item) for item in payload.get("results", [])]
    _search_cache.set(key, mapped)
    return {"results": mapped, "cached": False, "stale": False}


# --------------------------------------------------------------------------
# Tavily - the pre-call policy brief
# --------------------------------------------------------------------------

async def tavily_brief(venue_name: str, city: str) -> dict[str, Any]:
    """One search, truncated hard to 600 chars.

    CORRECTED vs the PRD: auth is a bearer token in the Authorization header.
    The `api_key`-in-body form is legacy.

    A long brief pushes up time-to-first-token on the call, which the room
    hears as dead air. Keep it tight.
    """
    if not has_tavily():
        return {"policy_brief": "", "sources": []}

    query = f"{venue_name} {city} reservation policy opening hours dress code outdoor seating"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.post(
                TAVILY_URL,
                headers={"Authorization": f"Bearer {os.environ['TAVILY_API_KEY'].strip()}"},
                json={
                    "query": query,
                    "search_depth": "basic",
                    "max_results": 3,
                    "include_answer": True,
                },
            )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        print(f"[tavily] {type(exc).__name__}: {exc}")
        return {"policy_brief": "", "sources": []}

    answer = (payload.get("answer") or "").strip()
    if not answer:
        answer = " ".join(
            (item.get("content") or "").strip()
            for item in payload.get("results", [])[:2]
        ).strip()

    return {
        "policy_brief": answer[:600],
        "sources": [item.get("url") for item in payload.get("results", []) if item.get("url")],
    }


# --------------------------------------------------------------------------
# The client-ready note - template first, Claude as an upgrade
# --------------------------------------------------------------------------

def _pretty_date(iso_date: str | None) -> str:
    """'2026-08-20' -> '20 August'. Advisors paste this into WhatsApp; ISO reads robotic."""
    if not iso_date:
        return ""
    try:
        parsed = date.fromisoformat(iso_date)
    except (ValueError, TypeError):
        return str(iso_date)
    return f"{parsed.day} {parsed.strftime('%B')}"


def deterministic_note(task: dict[str, Any]) -> str:
    """A competent traveler-facing note with zero LLM calls.

    This is the one that has to work. Claude only ever improves on it.
    """
    result = task.get("result") or {}
    venue = task.get("venue") or {}
    request = task.get("request") or {}
    traveler = ((task.get("traveler") or {}).get("name") or "").strip()

    name = venue.get("name", "the venue")
    when = _pretty_date(request.get("date"))
    party = result.get("party_size") or request.get("party_size") or 2
    greeting = f"{traveler} — " if traveler else ""

    if result.get("reservation_confirmed"):
        at_time = result.get("confirmed_time") or ""
        time_phrase = f" at **{at_time}**" if at_time else ""
        held_by = result.get("name_on_reservation") or traveler
        under = f" under **{held_by}**" if held_by else ""
        kind = (venue.get("kind") or "restaurant").strip().lower()
        booked_for = {
            "tour": f"**{party}** places",
            "bar": f"**{party}** people",
        }.get(kind, f"Table for **{party}**")
        lines = [
            f"{greeting}you're booked at **{name}**.",
            f"{booked_for} on **{when}**{time_phrase}{under}.",
        ]

        # Say so when they didn't get the time they asked for - burying that
        # is how someone turns up an hour early.
        requested = (result.get("requested_time") or "").strip()
        if requested and at_time and requested.lower() != at_time.lower():
            lines.append(f"You asked for {requested}; **{at_time}** is what was available.")

        if code := result.get("confirmation_code"):
            lines.append(f"Confirmation **{code}**.")
        if price := result.get("price"):
            lines.append(f"Price: **{price}**.")
        if check_in := result.get("check_in"):
            lines.append(f"Check in at **{check_in}**.")
    else:
        lines = [f"{greeting}**{name}** couldn't take a booking for **{when}**."]
        if alternatives := result.get("alternatives_offered"):
            lines.append(f"They offered **{', '.join(alternatives)}** instead.")

    if special := result.get("special_requests_status"):
        lines.append(special.rstrip(".") + ".")
    if notes := result.get("notes"):
        lines.append(notes.rstrip(".") + ".")

    return " ".join(lines)


async def claude_note(task: dict[str, Any]) -> tuple[str, str]:
    """Claude writes the note on top of the already-structured result.

    Returns (markdown, source) where source is "claude" or "template".

    Claude is never on the critical path for the card itself - the card comes
    from the agent's mid-call tool call. If Anthropic is slow, rate-limited, or
    unconfigured, the advisor still gets a usable note. That fallback is
    specified by the PRD, not an unrequested safety net.
    """
    fallback = deterministic_note(task)
    if not has_anthropic():
        return fallback, "template"

    import anthropic

    result = task.get("result") or {}
    venue = task.get("venue") or {}
    request = task.get("request") or {}

    facts = {
        "venue": venue.get("name"),
        "venue_kind": venue.get("kind"),
        "requested_date": request.get("date"),
        "requested_time": request.get("time"),
        "requested_party_size": request.get("party_size"),
        "traveler_name": (task.get("traveler") or {}).get("name"),
        "traveler_notes": (task.get("traveler") or {}).get("notes"),
        "confirmed_on_call": result,
    }

    system = (
        "You write a short, warm confirmation message to a traveler about a "
        "reservation an assistant just made for them by phone. Three or four "
        "sentences. Lead with whether it is booked and when. Never invent a "
        "fact - state only what was confirmed on the call. No sign-off, no "
        "markdown headings, no greeting beyond their first name.\n\n"
        "Wrap the details they will need to act on in **double asterisks**: "
        "the time, the confirmation number, the price, and where to check in. "
        "If the time booked differs from the time requested, say so plainly - "
        "burying that is how someone arrives an hour early."
    )

    try:
        client = anthropic.AsyncAnthropic()
        # 6s ceiling, no retries: a stall must cost 6 seconds, not 18.
        message = await client.with_options(timeout=6.0, max_retries=0).messages.create(
            model="claude-sonnet-5",
            max_tokens=400,
            system=system,
            thinking={"type": "disabled"},
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": str(facts)}],
        )
    except Exception as exc:  # noqa: BLE001 - any failure means "use the template"
        print(f"[anthropic] {type(exc).__name__}: {exc}. Falling back to template.")
        return fallback, "template"

    if message.stop_reason == "refusal":
        print("[anthropic] refusal. Falling back to template.")
        return fallback, "template"

    text = "".join(block.text for block in message.content if block.type == "text").strip()
    return (text, "claude") if text else (fallback, "template")
