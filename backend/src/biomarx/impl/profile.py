"""The user's own profile entries, in `profile.json` beside the database so an import never replaces them."""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
from pathlib import Path

from biomarx.core.domain import Sex

log = logging.getLogger(__name__)


class FileProfileOverrides:
    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> tuple[dt.date | None, Sex | None]:
        try:
            d = json.loads(self.path.read_text())
            sex = d.get("sex") if d.get("sex") in ("male", "female") else None
            return (dt.date.fromisoformat(d["birth_date"]) if d.get("birth_date") else None), sex
        except FileNotFoundError:
            return None, None
        except (ValueError, TypeError, KeyError, AttributeError):
            log.warning("ignoring an unreadable %s", self.path.name)
            return None, None

    def save(self, birth_date: dt.date | None, sex: Sex | None) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(json.dumps({"birth_date": birth_date.isoformat() if birth_date else None, "sex": sex}))
        os.replace(tmp, self.path)
