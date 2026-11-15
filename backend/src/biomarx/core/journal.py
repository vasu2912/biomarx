"""The person's own record of each day: what the export cannot see.

A day is either unreviewed (absent) or reviewed with a set of tags, which may be empty ("nothing to note"). So a tagged day is
always reviewed, and an unreviewed day never carries a tag.
"""

from __future__ import annotations

import datetime as dt
import hashlib
from dataclasses import dataclass, field

EARLIEST = dt.date(1900, 1, 1)
MAX_CUSTOM = 20
LABEL_MAX = 24


class JournalError(ValueError):
    """A request the journal refuses. The message is written for the user."""


@dataclass(frozen=True)
class Tag:
    key: str
    label: str
    hint: str = ""
    custom: bool = False


CATALOGUE: tuple[Tag, ...] = (
    Tag("alcohol", "Alcohol"),
    Tag("late_meal", "Late meal", "Within 3 h of bed"),
    Tag("caffeine_pm", "Caffeine after 2 pm"),
    Tag("sauna", "Sauna"),
    Tag("cold", "Cold exposure"),
    Tag("illness", "Illness"),
    Tag("travel", "Travel across time zones"),
    Tag("stress", "High stress"),
)
BUILT_IN = frozenset(t.key for t in CATALOGUE)


def custom_key(label: str) -> str:
    """The same label, in any case or spacing, is the same tag, so adding it twice converges."""
    return "c-" + hashlib.sha1(normal_label(label).casefold().encode()).hexdigest()[:8]


def normal_label(label: str) -> str:
    return " ".join(label.split())


@dataclass(frozen=True)
class Journal:
    """Reviewed days in date order, each with its sorted tag keys, and the person's own tags in the order added."""

    days: tuple[tuple[dt.date, tuple[str, ...]], ...] = ()
    custom: tuple[Tag, ...] = ()
    _by_day: dict[dt.date, tuple[str, ...]] = field(default=None, init=False, repr=False, compare=False, hash=False)  # type: ignore[assignment]

    def __post_init__(self) -> None:
        object.__setattr__(self, "_by_day", dict(self.days))

    @property
    def tags(self) -> tuple[Tag, ...]:
        return CATALOGUE + self.custom

    def tag(self, key: str) -> Tag | None:
        return next((t for t in self.tags if t.key == key), None)

    def day(self, d: dt.date) -> tuple[str, ...] | None:
        """The day's tags, or None when it has not been reviewed."""
        return self._by_day.get(d)

    def between(self, start: dt.date | None, end: dt.date | None) -> tuple[tuple[dt.date, tuple[str, ...]], ...]:
        return tuple((d, t) for d, t in self.days if (start is None or d >= start) and (end is None or d < end))

    def with_day(self, d: dt.date, tags: frozenset[str] | None) -> Journal:
        """Replace one day: None makes it unreviewed again, a set (possibly empty) reviews it with exactly those tags."""
        if tags is not None and (unknown := sorted(tags - {t.key for t in self.tags})):
            raise JournalError(f"Unknown tag: {', '.join(unknown)}.")
        rest = {k: v for k, v in self.days if k != d}
        if tags is not None:
            rest[d] = tuple(sorted(tags))
        return Journal(tuple(sorted(rest.items())), self.custom)

    def with_custom(self, label: str) -> tuple[Journal, Tag]:
        label = normal_label(label)
        if not 1 <= len(label) <= LABEL_MAX:
            raise JournalError(f"A tag is 1 to {LABEL_MAX} characters.")
        key = custom_key(label)
        if found := next((t for t in self.custom if t.key == key), None):
            return self, found
        if any(t.label.casefold() == label.casefold() for t in CATALOGUE):
            raise JournalError(f"“{label}” is already a tag.")
        if len(self.custom) >= MAX_CUSTOM:
            raise JournalError(f"You can keep up to {MAX_CUSTOM} tags of your own.")
        tag = Tag(key, label, custom=True)
        return Journal(self.days, (*self.custom, tag)), tag

    def without_custom(self, key: str) -> Journal:
        """Drop one of the person's tags from the list and from every day; the days stay reviewed."""
        if key in BUILT_IN:
            raise JournalError("Built-in tags can’t be removed.")
        days = tuple((d, tuple(t for t in tags if t != key)) for d, tags in self.days)
        return Journal(days, tuple(t for t in self.custom if t.key != key))


def check_day(d: dt.date, today: dt.date) -> None:
    if not EARLIEST <= d <= today:
        raise JournalError(f"A journal day is between {EARLIEST.isoformat()} and today.")
