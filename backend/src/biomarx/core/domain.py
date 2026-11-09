from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from enum import IntEnum, StrEnum

MINUTES_PER_DAY = 1440


class SleepCode(IntEnum):
    """Per-minute sleep state painted from staged sleep records."""

    NONE = 0
    AWAKE = 1
    CORE = 2
    REM = 3
    DEEP = 4


ASLEEP_CODES = (SleepCode.CORE, SleepCode.REM, SleepCode.DEEP)


class ActogramCode(IntEnum):
    """Codes of the `sleep` raster: wear state merged with sleep stage."""

    NOT_WORN = 0
    AWAKE_WORN = 1
    AWAKE_IN_BED = 2
    CORE = 3
    REM = 4
    DEEP = 5


@dataclass(frozen=True)
class DayRange:
    """Half-open range of calendar days [start, end)."""

    start: dt.date
    end: dt.date

    def __post_init__(self) -> None:
        if self.end <= self.start:
            raise ValueError("range end must be after start")

    @property
    def days(self) -> int:
        return (self.end - self.start).days

    def previous(self) -> DayRange:
        return DayRange(self.start - dt.timedelta(days=self.days), self.start)


@dataclass(frozen=True)
class Timeline:
    """The dataset's day axis. Row i of every grid is calendar day `start + i`.

    Grids carry one extra trailing row so the last night's sleep, which ends on
    the following morning, still fits.
    """

    start: dt.date
    days: int

    @property
    def end(self) -> dt.date:
        return self.start + dt.timedelta(days=self.days)

    @property
    def rows(self) -> int:
        return self.days + 1

    @property
    def minutes(self) -> int:
        return self.rows * MINUTES_PER_DAY

    def index(self, day: dt.date) -> int:
        return (day - self.start).days

    def day(self, index: int) -> dt.date:
        return self.start + dt.timedelta(days=index)

    def clamp(self, r: DayRange) -> DayRange:
        start = min(max(r.start, self.start), self.end - dt.timedelta(days=1))
        end = max(min(r.end, self.end), start + dt.timedelta(days=1))
        return DayRange(start, end)

    def default_range(self, days: int = 365) -> DayRange:
        return self.clamp(DayRange(self.end - dt.timedelta(days=days), self.end))


class ImportState(StrEnum):
    UPLOADING = "uploading"
    QUEUED = "queued"
    PARSING = "parsing"
    DERIVING = "deriving"
    READY = "ready"
    FAILED = "failed"


TRANSITIONS: dict[ImportState, frozenset[ImportState]] = {
    ImportState.UPLOADING: frozenset({ImportState.QUEUED, ImportState.FAILED}),
    ImportState.QUEUED: frozenset({ImportState.PARSING, ImportState.FAILED}),
    ImportState.PARSING: frozenset({ImportState.DERIVING, ImportState.FAILED}),
    ImportState.DERIVING: frozenset({ImportState.READY, ImportState.FAILED}),
    ImportState.READY: frozenset(),
    ImportState.FAILED: frozenset(),
}


@dataclass
class ImportJob:
    id: str
    filename: str
    size: int
    state: ImportState = ImportState.UPLOADING
    progress: float = 0.0
    message: str = ""
    error: str | None = None
    records: int = 0
    created_at: dt.datetime = field(default_factory=lambda: dt.datetime.now(dt.UTC))
    finished_at: dt.datetime | None = None

    @property
    def active(self) -> bool:
        return self.state not in (ImportState.READY, ImportState.FAILED)

    def advance(self, state: ImportState, message: str = "", progress: float = 0.0) -> None:
        if state not in TRANSITIONS[self.state]:
            raise ValueError(f"illegal import transition {self.state} -> {state}")
        self.state, self.message, self.progress = state, message, progress
        if not self.active:
            self.finished_at = dt.datetime.now(dt.UTC)

    def report(self, progress: float, message: str | None = None, records: int | None = None) -> None:
        self.progress = min(max(progress, 0.0), 1.0)
        if message is not None:
            self.message = message
        if records is not None:
            self.records = records

    def fail(self, error: str) -> None:
        self.advance(ImportState.FAILED, "Import failed")
        self.error = error


@dataclass(frozen=True)
class Dataset:
    timeline: Timeline
    records: int
    nights: int
    sources: tuple[str, ...]
    exported_at: dt.datetime | None
    imported_at: dt.datetime
    version: str
