"""Reads and edits of the journal. Each edit reads the stored journal, applies one change and writes it back whole, so repeating
an edit, or retrying one that crashed before its write landed, ends in the same journal."""

from __future__ import annotations

import datetime as dt
import threading

from biomarx.core.journal import Journal, JournalError, Tag, check_day
from biomarx.core.ports import JournalStore


class JournalService:
    def __init__(self, store: JournalStore) -> None:
        self.store = store
        self._lock = threading.Lock()

    def get(self) -> Journal:
        return self.store.load()

    def set_day(self, d: dt.date, tags: frozenset[str], reviewed: bool, today: dt.date | None = None) -> Journal:
        check_day(d, today or dt.date.today())
        if tags and not reviewed:
            raise JournalError("A day with a tag is a reviewed day.")
        with self._lock:
            j = self.store.load().with_day(d, tags if reviewed else None)
            self.store.save(j)
        return j

    def add_tag(self, label: str) -> Tag:
        with self._lock:
            j, tag = self.store.load().with_custom(label)
            self.store.save(j)
        return tag

    def remove_tag(self, key: str) -> Journal:
        with self._lock:
            j = self.store.load().without_custom(key)
            self.store.save(j)
        return j
