"""The journal in `journal.json` beside the database, so an import never replaces it.

The file holds what the person wrote about their own days, so nothing from it is ever logged, even when it cannot be read.
"""

from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path

from biomarx.core.journal import BUILT_IN, LABEL_MAX, MAX_CUSTOM, Journal, Tag, custom_key


class FileJournalStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> Journal:
        try:
            d = json.loads(self.path.read_text())
            custom = tuple(Tag(str(t["key"]), str(t["label"]), custom=True) for t in d.get("custom", ()))[:MAX_CUSTOM]
            custom = tuple(t for t in custom if t.key == custom_key(t.label) and 1 <= len(t.label) <= LABEL_MAX)
            known = BUILT_IN | {t.key for t in custom}
            days = {dt.date.fromisoformat(k): tuple(sorted({str(x) for x in v} & known)) for k, v in d.get("days", {}).items()}
            return Journal(tuple(sorted(days.items())), custom)
        except (OSError, ValueError, TypeError, KeyError, AttributeError):
            return Journal()

    def save(self, journal: Journal) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        body = {
            "custom": [{"key": t.key, "label": t.label} for t in journal.custom],
            "days": {d.isoformat(): list(tags) for d, tags in journal.days},
        }
        tmp = self.path.with_name(self.path.name + ".tmp")
        with tmp.open("w") as f:
            json.dump(body, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self.path)
