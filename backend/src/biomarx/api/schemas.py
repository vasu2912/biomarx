"""Wire types. These are the OpenAPI contract the frontend generates its types from."""

from __future__ import annotations

import datetime as dt

import numpy as np
from pydantic import BaseModel

from biomarx.core.domain import Dataset, ImportJob, ImportState
from biomarx.core.metrics import Direction, Metric, MetricGroup

Num = float | None
Vec = list[Num]


def vec(a, decimals: int = 4) -> Vec:
    arr = np.asarray(a, dtype=np.float64)
    out = np.round(arr, decimals).tolist()
    return [None if (v != v or v in (float("inf"), float("-inf"))) else v for v in out]


def num(x, decimals: int = 4) -> Num:
    if x is None:
        return None
    x = float(x)
    return round(x, decimals) if np.isfinite(x) else None


def mat(a, decimals: int = 4) -> list[Vec]:
    return [vec(r, decimals) for r in np.asarray(a)]


class RangeOut(BaseModel):
    start: dt.date
    end: dt.date


class DatasetOut(BaseModel):
    start: dt.date
    end: dt.date
    days: int
    records: int
    nights: int
    sources: list[str]
    exported_at: dt.datetime | None
    imported_at: dt.datetime
    version: str
    default_range: RangeOut

    @classmethod
    def of(cls, d: Dataset) -> DatasetOut:
        r = d.timeline.default_range()
        return cls(
            start=d.timeline.start,
            end=d.timeline.end,
            days=d.timeline.days,
            records=d.records,
            nights=d.nights,
            sources=list(d.sources),
            exported_at=d.exported_at,
            imported_at=d.imported_at,
            version=d.version,
            default_range=RangeOut(start=r.start, end=r.end),
        )


class ImportJobOut(BaseModel):
    id: str
    filename: str
    size: int
    state: ImportState
    progress: float
    message: str
    error: str | None
    records: int
    created_at: dt.datetime
    finished_at: dt.datetime | None

    @classmethod
    def of(cls, j: ImportJob) -> ImportJobOut:
        return cls(**{k: getattr(j, k) for k in cls.model_fields})


class StatusOut(BaseModel):
    dataset: DatasetOut | None
    active_import: ImportJobOut | None


class MetricOut(BaseModel):
    key: str
    label: str
    unit: str
    group: MetricGroup
    decimals: int
    direction: Direction
    description: str
    clock: bool

    @classmethod
    def of(cls, m: Metric) -> MetricOut:
        return cls(**{k: getattr(m, k) for k in cls.model_fields})


class CreateImportIn(BaseModel):
    filename: str
    size: int


class CreateImportOut(BaseModel):
    job: ImportJobOut
    chunk_size: int


class SummaryOut(BaseModel):
    range: RangeOut
    values: dict[str, Num]


class DailyOut(BaseModel):
    range: RangeOut
    days: list[dt.date]
    columns: dict[str, Vec]


class NightsOut(BaseModel):
    range: RangeOut
    nights: list[dt.date]
    columns: dict[str, Vec]


class ArchitectureOut(BaseModel):
    range: RangeOut
    nights: int
    minutes: int
    order: list[str]
    probability: dict[str, Vec]
    transitions: list[Vec]
    transition_counts: list[Vec]


class CircularOut(BaseModel):
    hour: Num
    r: Num


class WeekdayOut(BaseModel):
    weekday: int
    label: str
    free: bool
    values: Vec
    median: Num


class ChronotypeOut(BaseModel):
    range: RangeOut
    histograms: dict[str, list[int]]
    circular: dict[str, CircularOut]
    weekday: list[WeekdayOut]
    msw: Num
    msf: Num
    msfsc: Num
    social_jetlag_min: Num


class PeriodogramOut(BaseModel):
    range: RangeOut
    periods: Vec
    hr: Vec
    steps: Vec
    dominant_hr_period: Num


class CorrelationOut(BaseModel):
    range: RangeOut
    metrics: list[str]
    rho: list[Vec]
    q: list[Vec]
    n: list[Vec]


class StateOut(BaseModel):
    range: RangeOut
    days: list[dt.date]
    metrics: list[str]
    z: list[Vec]


class DoseResponseOut(BaseModel):
    x_edges: Vec
    y_edges: Vec
    counts: list[Vec]
    median_x: Vec
    median_hr: Vec
    bins: int


class RidgeMonthOut(BaseModel):
    month: str
    awake: Vec | None
    asleep: Vec | None


class RidgelineOut(BaseModel):
    hr: Vec
    months: list[RidgeMonthOut]


class HrActivityOut(BaseModel):
    range: RangeOut
    dose_response: DoseResponseOut
    ridgeline: RidgelineOut


class EcgSummaryOut(BaseModel):
    id: str
    recorded_at: dt.datetime
    classification: str
    sample_rate: float
    device: str
    duration_s: float
    mean_hr: Num
    rmssd: Num


class EcgDetailOut(BaseModel):
    summary: EcgSummaryOut
    trace: Vec
    peaks: list[int]
    rri: Vec
    sd1: Num
    sd2: Num
    beat_ms: Vec
    beat_median: Vec
    beats: list[Vec]


class ErrorOut(BaseModel):
    detail: str
