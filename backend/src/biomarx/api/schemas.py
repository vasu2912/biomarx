"""Wire types. These are the OpenAPI contract the frontend generates its types from."""

from __future__ import annotations

import datetime as dt
from typing import Literal

import numpy as np
from pydantic import BaseModel, field_validator

from biomarx.core.domain import Dataset, ImportJob, ImportState
from biomarx.core.journal import LABEL_MAX, MAX_CUSTOM, Journal, Tag
from biomarx.core.metrics import Direction, Metric, MetricGroup
from biomarx.core.services.profile import Profile

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


ProfileSource = Literal["export", "user"] | None


class ProfileSourceOut(BaseModel):
    birth_date: ProfileSource
    sex: ProfileSource


class ProfileOut(BaseModel):
    birth_date: dt.date | None
    sex: Literal["male", "female", "other"] | None
    age: int | None
    source: ProfileSourceOut

    @classmethod
    def of(cls, p: Profile) -> ProfileOut:
        src = ProfileSourceOut(birth_date=p.birth_date_source, sex=p.sex_source)
        return cls(birth_date=p.birth_date, sex=p.sex, age=p.age, source=src)  # type: ignore[arg-type]


class ProfileIn(BaseModel):
    """The user's overrides. A null field falls back to the export."""

    birth_date: dt.date | None = None
    sex: Literal["male", "female"] | None = None

    @field_validator("birth_date")
    @classmethod
    def _plausible(cls, v: dt.date | None) -> dt.date | None:
        if v is not None and not dt.date(1900, 1, 1) <= v <= dt.date.today():
            raise ValueError("must be between 1900-01-01 and today")
        return v


class JournalTagOut(BaseModel):
    key: str
    label: str
    hint: str
    custom: bool

    @classmethod
    def of(cls, t: Tag) -> JournalTagOut:
        return cls(key=t.key, label=t.label, hint=t.hint, custom=t.custom)


class JournalDayOut(BaseModel):
    """One calendar day. `answered` means the person reviewed it; a reviewed day with no tags had nothing to note."""

    date: dt.date
    tags: list[str]
    answered: bool

    @classmethod
    def of(cls, d: dt.date, tags: tuple[str, ...] | None) -> JournalDayOut:
        return cls(date=d, tags=list(tags or ()), answered=tags is not None)


class JournalOut(BaseModel):
    """Every tag, built-in first, and the reviewed days of the range in date order. A day not listed was not reviewed."""

    tags: list[JournalTagOut]
    days: list[JournalDayOut]
    max_custom: int
    label_max: int

    @classmethod
    def of(cls, j: Journal, start: dt.date | None, end: dt.date | None) -> JournalOut:
        return cls(
            tags=[JournalTagOut.of(t) for t in j.tags],
            days=[JournalDayOut.of(d, t) for d, t in j.between(start, end)],
            max_custom=MAX_CUSTOM,
            label_max=LABEL_MAX,
        )


class JournalDayIn(BaseModel):
    """The whole entry for one day. `answered: false` with no tags makes the day unreviewed again."""

    tags: list[str] = []
    answered: bool = True


class JournalTagIn(BaseModel):
    label: str


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


class WorkoutOut(BaseModel):
    activity: str
    start: dt.datetime
    duration_min: float
    strength: bool
    trimp: Num


class StepBandOut(BaseModel):
    label: str
    lo: int
    hi: int


class FitnessOut(BaseModel):
    """Weekly series over ISO weeks (Monday start) covering the range. `null` marks a week with nothing to measure."""

    range: RangeOut
    weeks: list[dt.date]
    week_days: list[int]
    moderate: Vec
    vigorous: Vec
    hrr_moderate: Vec
    hrr_vigorous: Vec
    hr_minutes: Vec
    trimp: Vec
    strength_days: list[int]
    workouts: list[list[WorkoutOut]]
    hrmax: Num
    age: int | None
    sex: Literal["male", "female"] | None
    steps_bands: list[StepBandOut]


class BaselineSignalOut(BaseModel):
    key: str
    concern: Literal["up", "down"]
    value: Vec
    median: Vec
    scale: Vec
    z: Vec


class BaselineOut(BaseModel):
    """Per day of the range (night D): each signal against the 28 nights before it. `scale` is 1.4826 × MAD."""

    range: RangeOut
    days: list[dt.date]
    signals: list[BaselineSignalOut]
    concurrent: list[int]
    flag_z: float
    min_concurrent: int
    baseline_nights: int
    min_baseline_nights: int


class BeatToBeatOut(BaseModel):
    """Per day of the range (night D): RMSSD from the beat lists inside the main episode, its natural log, the trailing
    mean of ln RMSSD over `rolling_nights` (with at least `min_rolling_nights`), and the robust baseline of ln RMSSD over
    the `baseline_nights` before it (`scale` is 1.4826 × MAD). `available` is false for a database imported before beat
    lists were kept."""

    range: RangeOut
    days: list[dt.date]
    available: bool
    rmssd: Vec
    ln_rmssd: Vec
    mean7: Vec
    median: Vec
    scale: Vec
    rolling_nights: int
    min_rolling_nights: int
    baseline_nights: int
    min_baseline_nights: int
    min_rr_ms: float
    max_rr_ms: float
    min_diffs: int


class SevenHoursOut(BaseModel):
    """Weekly share of nights with at least `floor_h` of sleep, and per night D the hours short of it over the last recorded nights."""

    range: RangeOut
    weeks: list[dt.date]
    week_days: list[int]
    week_nights: list[int]
    week_share: Vec
    days: list[dt.date]
    shortfall: Vec
    share: Num
    shortfall_median: Num
    floor_h: float
    shortfall_nights: int


class ExposureGroupOut(BaseModel):
    label: str
    short: str


class ExposureOut(BaseModel):
    """One entry of the exposure catalogue. `reason` says, for the reader, why an unavailable exposure cannot be computed."""

    key: str
    label: str
    kind: Literal["groups", "continuous"]
    groups: list[ExposureGroupOut]
    unit: str
    available: bool
    reason: str | None
    source: Literal["watch", "journal", "logs"]


class GroupCellOut(BaseModel):
    """One group of one outcome. The reference group (first) and groups under the minimum carry only `n` and `median`."""

    n: int
    median: Num
    diff: Num
    ci_lo: Num
    ci_hi: Num
    p: Num
    q: Num


class ExposureCorrelationOut(BaseModel):
    n: int
    rho: Num
    p: Num
    q: Num


class ExposureOutcomeOut(BaseModel):
    key: str
    label: str
    cells: list[GroupCellOut]
    correlation: ExposureCorrelationOut | None


class ExposuresOut(BaseModel):
    """Per night D of the range, the chosen exposure (group index into `groups`, or the value) and each outcome."""

    range: RangeOut
    catalogue: list[ExposureOut]
    key: str
    outcomes: list[ExposureOutcomeOut]
    nights: list[dt.date]
    exposure: Vec
    columns: dict[str, Vec]
    min_group: int
    min_paired: int
    resamples: int


class SeasonOut(BaseModel):
    """Per ISO week 1–53: the median across years of weekly medians, the quartiles across years (null under two years) and the years."""

    key: str
    median: Vec
    q25: Vec
    q75: Vec
    years: list[int]


class EnvironmentOut(BaseModel):
    """Weekly noise dose over ISO weeks covering the range, as % of the weekly allowance; seasons cover the whole dataset.

    A headphone week without samples is 0 (nothing was played); an environmental week without samples is null (not measured).
    """

    range: RangeOut
    weeks: list[dt.date]
    week_days: list[int]
    headphone: Vec
    headphone_samples: list[int]
    environmental: Vec
    environmental_samples: list[int]
    reference_db: float
    allowance_hours: float
    season_span: RangeOut
    seasons: list[SeasonOut]


class SourceFamilyOut(BaseModel):
    key: str
    label: str
    source: list[int | None]


class SourcesOut(BaseModel):
    """Per day of the range, the index into `sources` of the source that supplied each record family; null for none.

    Sleep is by night D, the main episode that starts after noon on day D. `sources` is ordered by days supplied over the whole dataset.
    """

    range: RangeOut
    days: list[dt.date]
    sources: list[str]
    families: list[SourceFamilyOut]


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
