"""The one place that decides which .env this module loads.

`load_dotenv()` with no argument searches *upward* from the calling file until
it finds a `.env`. That works while `concierge-line/.env` exists, but if that
file ever goes missing the search climbs into the repo root and loads the
TypeScript app's `.env` instead — a different file, none of these keys, and no
sign that it happened. Anchoring the path to this file's own folder removes the
guess: we load our sibling `.env`, or nothing at all.

Import this before anything reads `os.environ`. Values land in the process
environment as usual, so existing `os.environ` reads keep working unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

ENV_PATH = Path(__file__).resolve().parent / ".env"

# override=False so a variable exported in the shell beats the file — that is
# what you want when overriding one value for a single run.
load_dotenv(ENV_PATH, override=False)


@dataclass(frozen=True)
class EnvSource:
    """What was loaded, for reporting. Never carries the values themselves."""

    path: Path
    found: bool
    keys: int
    set_keys: int


def describe() -> EnvSource:
    """Report the resolved file so a blank value can be told apart from a
    file that was never there — the two look identical from `os.environ`."""
    if not ENV_PATH.is_file():
        return EnvSource(path=ENV_PATH, found=False, keys=0, set_keys=0)

    values = dotenv_values(ENV_PATH)
    return EnvSource(
        path=ENV_PATH,
        found=True,
        keys=len(values),
        set_keys=sum(1 for value in values.values() if value and value.strip()),
    )
