"""Interfaces the core depends on. Implementations live in `biomarx.impl`."""

from __future__ import annotations

import datetime as dt
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

import numpy as np

from biomarx.core.analysis.derived import Derived
from biomarx.core.analysis.grids import SleepSegments
from biomarx.core.domain import Dataset, ImportJob

Series = tuple[np.ndarray, np.ndarray]


@dataclass(frozen=True)
class EcgRecording:
    id: str
    recorded_at: dt.datetime
    classification: str
    sample_rate: float
    device: str
    microvolts: np.ndarray


class RecordReader(Protocol):
    """Queries over raw records, with the source de-duplication rules applied."""

    def heart_rate_span(self) -> tuple[dt.date, dt.date] | None: ...
    def heart_rate_minutes(self, origin: dt.date) -> Series: ...
    def steps_bins(self, origin: dt.date) -> Series: ...
    def sleep_segments(self, origin: dt.date) -> SleepSegments: ...
    def samples(self, record_type: str, origin: dt.date) -> Series: ...
    def daily_best_source(self, record_type: str, agg: Literal["mean", "sum"], origin: dt.date) -> Series: ...
    def daily_median(self, record_type: str, origin: dt.date) -> Series: ...


class RecordSink(Protocol):
    def add_records(self, batch: dict[str, list]) -> None: ...
    def add_workouts(self, batch: dict[str, list]) -> None: ...
    def add_ecg(self, ecg: EcgRecording) -> None: ...
    def set_export_date(self, exported_at: dt.datetime | None) -> None: ...


class Staging(Protocol):
    """A fresh database being filled by one import, published atomically on success."""

    sink: RecordSink
    reader: RecordReader

    def finish_records(self) -> None: ...
    def write_derived(self, derived: Derived) -> None: ...
    def publish(self) -> None: ...


class Store(Protocol):
    def dataset(self) -> Dataset | None: ...
    def derived(self) -> Derived | None: ...
    def ecg_recordings(self) -> list[EcgRecording]: ...
    def staging(self) -> AbstractContextManager[Staging]: ...


ProgressFn = Callable[[float, str, int], None]


class ExportReader(Protocol):
    """Streams an Apple Health export (zip or xml) into a sink."""

    def read(self, path: Path, sink: RecordSink, progress: ProgressFn) -> int: ...


class UploadStore(Protocol):
    def create(self, job_id: str) -> None: ...
    def write_chunk(self, job_id: str, index: int, data: bytes) -> int: ...
    def assemble(self, job_id: str, filename: str) -> Path: ...
    def discard(self, job_id: str) -> None: ...


class JobRunner(Protocol):
    def submit(self, fn: Callable[[], None]) -> None: ...


class JobRegistry(Protocol):
    def add(self, job: ImportJob) -> None: ...
    def get(self, job_id: str) -> ImportJob | None: ...
    def active(self) -> ImportJob | None: ...
