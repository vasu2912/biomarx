"""What happened before a night, against how that night went, within one person.

An exposure assigns each night D (the main sleep episode starting after noon on day D) either a group or a number, or nothing.
Outcomes are columns of the nights table. Every statistic here is an association between nights of one person, never a cause.

Groups: each group against the reference group by the difference in medians, a percentile-bootstrap 95% CI and a two-sided
Mann–Whitney U p; continuous: Spearman rho. Benjamini–Hochberg adjusts the p-values of one exposure together.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, Protocol

import numpy as np
from scipy import stats

from biomarx.core.analysis.fitness import Workouts
from biomarx.core.analysis.sleep import Nights
from biomarx.core.domain import MINUTES_PER_DAY
from biomarx.core.journal import CATALOGUE, Journal, Tag

Kind = Literal["groups", "continuous"]
# Where an exposure comes from. Anything not from the watch reads the journal, so it changes without a new import.
Source = Literal["watch", "journal", "logs"]
SOURCES: tuple[Source, ...] = ("watch", "journal", "logs")

MIN_GROUP = 5
MIN_PAIRED = 10
RESAMPLES = 2000
SEED = 20190201
CI = 0.95

MORNING_MIN = 120
# Daylight is only known while the device that logs it is on the wrist: a morning needs it worn for at least half the window.
MORNING_MIN_WEAR = 0.5


class Unavailable(Exception):
    """The exposure cannot be computed for this dataset or profile; the message says why, for the reader."""


@dataclass(frozen=True)
class Outcome:
    key: str
    label: str


OUTCOMES: tuple[Outcome, ...] = (
    Outcome("tst", "Total sleep"),
    Outcome("deep_pct", "Deep %"),
    Outcome("rem_pct", "REM %"),
    Outcome("waso", "Awake in bed"),
    Outcome("hrv", "Night HRV (SDNN)"),
    Outcome("night_hr", "Sleeping HR"),
    Outcome("rhr_next", "Next-day resting HR"),
    Outcome("onset_h", "Sleep onset"),
)


@dataclass(frozen=True)
class Group:
    label: str
    short: str


@dataclass(frozen=True)
class Daylight:
    """TimeInDaylight samples as grid minutes, and per grid minute whether the device that logs daylight was worn."""

    start: np.ndarray  # int minute index
    dur: np.ndarray  # minutes
    value: np.ndarray  # minutes of daylight inside the sample
    measured: np.ndarray  # bool per grid minute


@dataclass(frozen=True)
class Logs:
    """Apple Health food and drink logs as grid minutes: drinks and caffeine with their values, and the start of every log."""

    drinks: tuple[np.ndarray, np.ndarray]
    caffeine: tuple[np.ndarray, np.ndarray]
    any_log: np.ndarray


class Inputs(Protocol):
    """What exposures read. Values are fetched lazily, so an exposure only pays for what it uses."""

    nights: Nights
    origin: dt.date  # the calendar day of grid day 0
    journal: Journal

    def workouts(self) -> Workouts: ...
    def workout_trimp(self) -> np.ndarray:
        """Banister TRIMP per workout, NaN without heart rate. Raises Unavailable without age and sex."""
        ...

    def daylight(self) -> Daylight: ...
    def logs(self) -> Logs: ...


@dataclass(frozen=True)
class Exposure:
    key: str
    label: str
    kind: Kind
    # Per night row of `inputs.nights`: the group index (groups[0] is the reference) or the value; NaN for nothing.
    values: Callable[[Inputs], np.ndarray]
    groups: tuple[Group, ...] = ()
    unit: str = ""
    source: Source = "watch"


# ---------------------------------------------------------------- workout timing

# Stutz J et al. Effects of evening exercise on sleep in healthy participants. Sports Med 2019;49:269–287.
TIMING_GROUPS: tuple[Group, ...] = (
    Group("No workout", "None"),
    Group("More than 3 h before sleep", "> 3 h"),
    Group("1 to 3 h", "1–3 h"),
    Group("Within 1 h", "< 1 h"),
)


def timing_groups(nights: Nights, workout_end: np.ndarray, counts: np.ndarray) -> np.ndarray:
    """Group index per night by the gap from the last counted workout's end to sleep onset.

    A workout belongs to night D when it ends between midnight starting day D (or the end of night D−1, if later) and the end of
    night D's sleep. A night with no
    workout at all is the reference; a night whose workouts are none of the counted ones, or whose last counted one ends after
    onset, gets nothing.
    """
    order = np.argsort(workout_end, kind="stable")
    end, use = workout_end[order], counts[order]
    out = np.full(len(nights), np.nan)
    lo = np.searchsorted(end, np.maximum(nights.night * MINUTES_PER_DAY, previous_wake(nights)), side="left")
    hi = np.searchsorted(end, nights.i1, side="left")
    for k, (a, b, onset) in enumerate(zip(lo, hi, nights.i0, strict=True)):
        if a == b:
            out[k] = 0
            continue
        mine = end[a:b][use[a:b]]
        if mine.size == 0 or mine[-1] > onset:
            continue
        gap = onset - mine[-1]
        out[k] = 3 if gap < 60 else 2 if gap <= 180 else 1
    return out


def previous_wake(nights: Nights) -> np.ndarray:
    """Per night D, the end of night D−1's main episode, or −1 when that night is missing."""
    by_night = dict(zip(nights.night.tolist(), nights.i1.tolist(), strict=True))
    return np.array([by_night.get(int(n) - 1, -1) for n in nights.night], dtype=np.int64)


def _all_workouts(src: Inputs) -> np.ndarray:
    w = src.workouts()
    return timing_groups(src.nights, w.end, np.ones(len(w), bool))


def hard(trimp: np.ndarray) -> np.ndarray:
    """Workouts at or above the person's median workout TRIMP; a workout without heart rate is never hard."""
    ok = np.isfinite(trimp)
    if not ok.any():
        raise Unavailable("No workout in this dataset has heart rate to weigh it by.")
    return ok & (np.nan_to_num(trimp, nan=-np.inf) >= np.median(trimp[ok]))


def _hard_workouts(src: Inputs) -> np.ndarray:
    return timing_groups(src.nights, src.workouts().end, hard(src.workout_trimp()))


# ---------------------------------------------------------------- daylight


def overlap_sum(start: np.ndarray, dur: np.ndarray, value: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> np.ndarray:
    """Per window [lo, hi): the sum of each sample's value times the share of the sample's interval inside the window."""
    out = np.zeros(lo.size)
    if start.size == 0:
        return out
    order = np.argsort(start, kind="stable")
    s, d, v = start[order], dur[order], value[order]
    reach = float(d.max())
    a = np.searchsorted(s, lo - reach, side="left")
    b = np.searchsorted(s, hi, side="left")
    for k in range(lo.size):
        ss, dd, vv = s[a[k] : b[k]], d[a[k] : b[k]], v[a[k] : b[k]]
        inside = np.clip(np.minimum(ss + dd, hi[k]) - np.maximum(ss, lo[k]), 0, None)
        with np.errstate(invalid="ignore", divide="ignore"):
            out[k] = float(np.sum(np.where(dd > 0, vv * inside / dd, np.where((ss >= lo[k]) & (ss < hi[k]), vv, 0.0))))
    return out


def morning_daylight(nights: Nights, light: Daylight, window: int = MORNING_MIN) -> np.ndarray:
    """Daylight minutes in the first `window` minutes after the wake time that began day D (the end of night D−1)."""
    wake = previous_wake(nights)
    out = np.full(len(nights), np.nan)
    has = (wake >= 0) & (wake + window <= light.measured.size)
    if not has.any():
        return out
    lo = wake[has]
    worn = np.cumsum(np.r_[0, light.measured.astype(np.int64)])
    enough = (worn[lo + window] - worn[lo]) >= MORNING_MIN_WEAR * window
    got = overlap_sum(light.start, light.dur, light.value, lo, lo + window)
    out[np.flatnonzero(has)] = np.where(enough, got, np.nan)
    return out


def daily_daylight(light: Daylight, nd: int, min_wear: float) -> np.ndarray:
    """Daylight minutes per day, each sample on its start day; missing on days the logging device was worn too little."""
    day = light.start // MINUTES_PER_DAY
    keep = (day >= 0) & (day < nd)
    total = np.bincount(day[keep], light.value[keep], minlength=nd).astype(float)
    worn = light.measured[: nd * MINUTES_PER_DAY].reshape(nd, MINUTES_PER_DAY).mean(axis=1)
    return np.where(worn > min_wear, total, np.nan)


def _morning_daylight(src: Inputs) -> np.ndarray:
    light = src.daylight()
    if light.value.size == 0:
        raise Unavailable("The export has no time-in-daylight samples; the watch logs them from watchOS 10.")
    return morning_daylight(src.nights, light)


# ---------------------------------------------------------------- the journal

TAG_GROUPS: tuple[Group, ...] = (Group("Not tagged", "No tag"), Group("Tagged", "Tagged"))


def reviewed_tags(nights: Nights, journal: Journal, origin: dt.date) -> list[tuple[str, ...] | None]:
    """Per night D, the journal's tags for day D, or None when day D was not reviewed."""
    return [journal.day(origin + dt.timedelta(days=int(n))) for n in nights.night]


def tag_groups(nights: Nights, journal: Journal, origin: dt.date, key: str) -> np.ndarray:
    """1 when day D carries the tag, 0 when day D was reviewed without it, nothing when day D was not reviewed."""
    return np.array([np.nan if t is None else float(key in t) for t in reviewed_tags(nights, journal, origin)])


def need_both(codes: np.ndarray, what: str, other: str, note: str = "") -> np.ndarray:
    """A yes/no exposure is only worth listing when both sides reach the minimum somewhere in the data."""
    yes, no = int(np.sum(codes == 1)), int(np.sum(codes == 0))
    if yes < MIN_GROUP or no < MIN_GROUP:
        raise Unavailable(
            f"{yes} {'night follows' if yes == 1 else 'nights follow'} {what} and {no} {other}; a comparison needs at least {MIN_GROUP} of each.{note}"
        )
    return codes


def tag_exposure(tag: Tag) -> Exposure:
    def values(src: Inputs) -> np.ndarray:
        if not src.journal.days:
            raise Unavailable("Nothing is in your journal yet. Review days in Fig. 5.5 to compare the nights after them.")
        codes = tag_groups(src.nights, src.journal, src.origin, tag.key)
        return need_both(codes, f"a day tagged “{tag.label}”", "a reviewed day without it")

    return Exposure(f"tag:{tag.key}", tag.label, "groups", values, TAG_GROUPS, source="journal")


# ---------------------------------------------------------------- food and drink logs

# Absence of a log is not proof of none: a night is a reference night only when day D has some other food or drink log, or the
# person reviewed day D in the journal without the matching tag.
UNLOGGED_NOTE = " A day without a log counts as none only when it has another food or drink log, or you reviewed it in the journal."
CAFFEINE_WINDOW_MIN = 8 * 60

DRINK_GROUPS: tuple[Group, ...] = (Group("No drinks logged", "None"), Group("Any drinks", "Drinks"))
CAFFEINE_GROUPS: tuple[Group, ...] = (Group("Earlier or none", "Early"), Group("Within 8 h of sleep", "< 8 h"))


def vouched(nights: Nights, any_log: np.ndarray, tags: list[tuple[str, ...] | None], contradicts: str) -> np.ndarray:
    """Per night D, whether day D can stand for "none": it has any food or drink log, or was reviewed without `contradicts`."""
    days = np.unique(any_log // MINUTES_PER_DAY)
    logged = np.isin(nights.night, days)
    return logged | np.array([t is not None and contradicts not in t for t in tags], dtype=bool)


def _windows(nights: Nights, start: np.ndarray, value: np.ndarray) -> tuple[list[np.ndarray], list[bool]]:
    """Per night D, the start minutes of positive logs from midnight of day D (or waking, if later) to onset, and whether any
    falls in the night itself."""
    keep = value > 0
    s = np.sort(start[keep])
    lo = np.searchsorted(s, np.maximum(nights.night * MINUTES_PER_DAY, previous_wake(nights)), side="left")
    on = np.searchsorted(s, nights.i0, side="left")
    hi = np.searchsorted(s, nights.i1, side="left")
    return [s[a:b] for a, b in zip(lo, on, strict=True)], (hi > on).tolist()


def drink_groups(nights: Nights, drinks: tuple[np.ndarray, np.ndarray], ok: np.ndarray) -> np.ndarray:
    """1 when drinks were logged on day D before onset; 0 when none were and day D is vouched for; nothing otherwise, and
    nothing when drinks are logged during the night itself, since their timing against sleep is unclear."""
    before, during = _windows(nights, *drinks)
    out = np.full(len(nights), np.nan)
    for k, (b, d) in enumerate(zip(before, during, strict=True)):
        if b.size:
            out[k] = 1
        elif not d and ok[k]:
            out[k] = 0
    return out


def caffeine_groups(nights: Nights, caffeine: tuple[np.ndarray, np.ndarray], ok: np.ndarray, window: int = CAFFEINE_WINDOW_MIN) -> np.ndarray:
    """1 when the last caffeine logged on day D before onset was within `window` minutes of it; 0 when it was earlier, or none
    was logged on a vouched-for day; nothing otherwise, or when caffeine is logged during the night itself."""
    before, during = _windows(nights, *caffeine)
    out = np.full(len(nights), np.nan)
    for k, (b, d, onset) in enumerate(zip(before, during, nights.i0, strict=True)):
        if d:
            continue
        if b.size and onset - b[-1] <= window:
            out[k] = 1
        elif b.size or ok[k]:
            out[k] = 0
    return out


def _drinks(src: Inputs) -> np.ndarray:
    logs = src.logs()
    if logs.drinks[0].size == 0:
        raise Unavailable("The export has no alcoholic-drink logs. Health keeps them when you log drinks in the Health app or an app that writes to it.")
    ok = vouched(src.nights, logs.any_log, reviewed_tags(src.nights, src.journal, src.origin), "alcohol")
    return need_both(drink_groups(src.nights, logs.drinks, ok), "a day with drinks logged", "a logged or reviewed day without", UNLOGGED_NOTE)


def _caffeine(src: Inputs) -> np.ndarray:
    logs = src.logs()
    if logs.caffeine[0].size == 0:
        raise Unavailable("The export has no caffeine logs. Health keeps them when you log caffeine in the Health app or an app that writes to it.")
    ok = vouched(src.nights, logs.any_log, reviewed_tags(src.nights, src.journal, src.origin), "caffeine_pm")
    return need_both(
        caffeine_groups(src.nights, logs.caffeine, ok),
        "a day with caffeine within 8 h of sleep",
        "a logged or reviewed day with it earlier or not at all",
        UNLOGGED_NOTE,
    )


# Burns AC et al. Nat Ment Health 2023. Wright KP Jr et al. Curr Biol 2013;23:1554–1558.
# Pietilä J et al. JMIR Ment Health 2018;5:e23. Ebrahim IO et al. Alcohol Clin Exp Res 2013;37:539–549.
# Gardiner C et al. Sleep Med Rev 2023;69:101764. Drake C et al. J Clin Sleep Med 2013;9:1195–1200.
EXPOSURES: dict[str, Exposure] = {
    e.key: e
    for e in (
        Exposure("workout_timing", "After any workout", "groups", _all_workouts, TIMING_GROUPS),
        Exposure("hard_workout_timing", "After a hard workout", "groups", _hard_workouts, TIMING_GROUPS),
        Exposure("morning_daylight", "Morning daylight", "continuous", _morning_daylight, unit="min"),
        *(tag_exposure(t) for t in CATALOGUE),
        Exposure("alcohol_logged", "Alcoholic drinks", "groups", _drinks, DRINK_GROUPS, source="logs"),
        Exposure("caffeine_logged", "Late caffeine", "groups", _caffeine, CAFFEINE_GROUPS, source="logs"),
    )
}


def catalogue(journal: Journal) -> dict[str, Exposure]:
    """Every exposure, with one for each of the person's own tags, ordered watch, journal, logs."""
    every = [*EXPOSURES.values(), *(tag_exposure(t) for t in journal.custom)]
    return {e.key: e for e in sorted(every, key=lambda e: SOURCES.index(e.source))}


# ---------------------------------------------------------------- statistics


@dataclass(frozen=True)
class GroupCell:
    n: int
    median: float
    diff: float = np.nan
    ci_lo: float = np.nan
    ci_hi: float = np.nan
    p: float = np.nan
    q: float = np.nan


@dataclass(frozen=True)
class Correlation:
    n: int
    rho: float = np.nan
    p: float = np.nan
    q: float = np.nan


def bootstrap_median_diff(ref: np.ndarray, other: np.ndarray, resamples: int = RESAMPLES, seed: int = SEED) -> tuple[float, float]:
    """Percentile-bootstrap CI of median(other) − median(ref), resampling each group with replacement on its own."""
    rng = np.random.default_rng(seed)
    a = np.median(rng.choice(ref, (resamples, ref.size)), axis=1)
    b = np.median(rng.choice(other, (resamples, other.size)), axis=1)
    tail = (1 - CI) / 2 * 100
    lo, hi = np.percentile(b - a, [tail, 100 - tail])
    return float(lo), float(hi)


def compare(ref: np.ndarray, other: np.ndarray, min_n: int = MIN_GROUP) -> GroupCell:
    """One group against the reference. Fewer than `min_n` nights on either side gives the count and median only."""
    med = float(np.median(other)) if other.size else np.nan
    if other.size < min_n or ref.size < min_n:
        return GroupCell(int(other.size), med)
    lo, hi = bootstrap_median_diff(ref, other)
    p = stats.mannwhitneyu(other, ref, alternative="two-sided").pvalue
    return GroupCell(int(other.size), med, med - float(np.median(ref)), lo, hi, float(p))


def _fdr(p: np.ndarray) -> np.ndarray:
    q = np.full(p.size, np.nan)
    ok = np.isfinite(p)
    if ok.any():
        q[ok] = stats.false_discovery_control(p[ok])
    return q


def assess_groups(codes: np.ndarray, outcomes: dict[str, np.ndarray], n_groups: int) -> dict[str, list[GroupCell]]:
    """Per outcome, one cell per group (the reference first, with no difference); BH over every tested cell together."""
    raw: dict[str, list[GroupCell]] = {}
    for key, y in outcomes.items():
        ok = np.isfinite(y) & np.isfinite(codes)
        ref = y[ok & (codes == 0)]
        raw[key] = [GroupCell(int(ref.size), float(np.median(ref)) if ref.size else np.nan)]
        raw[key] += [compare(ref, y[ok & (codes == g)]) for g in range(1, n_groups)]
    flat = [c for cells in raw.values() for c in cells]
    q = _fdr(np.array([c.p for c in flat]))
    it = iter(q)
    return {k: [GroupCell(c.n, c.median, c.diff, c.ci_lo, c.ci_hi, c.p, next(it)) for c in cells] for k, cells in raw.items()}


def assess_continuous(x: np.ndarray, outcomes: dict[str, np.ndarray], min_n: int = MIN_PAIRED) -> dict[str, Correlation]:
    """Spearman rho of the exposure against each outcome over nights with both; BH across outcomes."""
    raw: dict[str, Correlation] = {}
    for key, y in outcomes.items():
        ok = np.isfinite(x) & np.isfinite(y)
        n = int(ok.sum())
        if n < min_n or np.ptp(x[ok]) == 0 or np.ptp(y[ok]) == 0:
            raw[key] = Correlation(n)
            continue
        r, p = stats.spearmanr(x[ok], y[ok])
        raw[key] = Correlation(n, float(r), float(p))
    q = _fdr(np.array([c.p for c in raw.values()]))
    return {k: Correlation(c.n, c.rho, c.p, qq) for (k, c), qq in zip(raw.items(), q, strict=True)}
