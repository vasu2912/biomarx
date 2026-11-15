"""Training load and activity against published guidelines.

Weekly bins are ISO weeks (Monday start). Every function here is pure: day-indexed arrays in, weekly arrays out.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Literal

import numpy as np

from biomarx.core.analysis._np import nanmedian
from biomarx.core.domain import MINUTES_PER_DAY

TrimpSex = Literal["male", "female"]

# Bull FC et al. WHO 2020 guidelines on physical activity and sedentary behaviour. Br J Sports Med 2020;54:1451–1462.
MODERATE_MET = 3.0
VIGOROUS_MET = 6.0

# Garber CE et al. ACSM position stand. Med Sci Sports Exerc 2011;43:1334–1359. At or above 90% HRR counts as vigorous here.
HRR_MODERATE = 0.40
HRR_VIGOROUS = 0.60

# Morton RH, Fitz-Clarke JR, Banister EW. J Appl Physiol 1990;69:1171–1177: TRIMP weighting a·e^(b·HRR).
TRIMP_COEF: dict[TrimpSex, tuple[float, float]] = {"male": (0.64, 1.92), "female": (0.86, 1.67)}

RHR_BASELINE_DAYS = 28

# HKWorkoutActivityType names (prefix stripped) that are resistance training in the WHO 2020 sense.
STRENGTH_TYPES: frozenset[str] = frozenset({"TraditionalStrengthTraining", "FunctionalStrengthTraining", "CoreTraining"})

# Paluch AE et al. Lancet Public Health 2022;7:e219–e228: where the mortality benefit of daily steps levels off.
STEP_BANDS: tuple[tuple[str, int, int, int | None, int | None], ...] = (
    ("Under 60", 8000, 10000, None, 60),
    ("60 and over", 6000, 8000, 60, None),
)


@dataclass(frozen=True)
class Workouts:
    """Workouts as grid minute indices from the timeline origin."""

    activity: np.ndarray  # str
    start: np.ndarray  # int minute index
    end: np.ndarray  # int minute index, exclusive

    def __len__(self) -> int:
        return self.activity.size


@dataclass(frozen=True)
class Weeks:
    """ISO weeks covering a day window, clipped to the timeline: week k spans days [lo[k], hi[k])."""

    monday: list[dt.date]
    lo: np.ndarray
    hi: np.ndarray

    @classmethod
    def covering(cls, origin: dt.date, lo: int, hi: int, nd: int) -> Weeks:
        first = lo - (origin + dt.timedelta(days=lo)).weekday()
        starts = np.arange(first, hi, 7)
        return cls(
            [origin + dt.timedelta(days=int(s)) for s in starts],
            np.clip(starts, 0, nd),
            np.clip(starts + 7, 0, nd),
        )

    def __len__(self) -> int:
        return len(self.monday)

    def of_days(self, days: np.ndarray) -> np.ndarray:
        """Week position of each day index, or -1 outside the weeks."""
        k = np.searchsorted(self.hi, days, side="right")
        ok = (k < len(self)) & (days >= self.lo[np.minimum(k, len(self) - 1)])
        return np.where(ok, k, -1)

    def sum(self, per_day: np.ndarray) -> np.ndarray:
        c = np.r_[0.0, np.cumsum(np.nan_to_num(per_day, nan=0.0))]
        return c[self.hi] - c[self.lo]


def hr_max(age: float) -> float:
    """Tanaka H, Monahan KD, Seals DR. J Am Coll Cardiol 2001;37:153–156."""
    return 208 - 0.7 * age


def hrr_fraction(hr: np.ndarray, rest: np.ndarray | float, hrmax: float) -> np.ndarray:
    """Karvonen heart-rate reserve fraction (HR − HRrest)/(HRmax − HRrest)."""
    rest = np.asarray(rest, dtype=float)
    span = hrmax - rest
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(span > 0, (hr - rest) / span, np.nan)


def trimp_per_minute(hrr: np.ndarray, sex: TrimpSex) -> np.ndarray:
    """Banister TRIMP of one minute at each HRR fraction, clipped to [0, 1]; NaN stays NaN."""
    a, b = TRIMP_COEF[sex]
    r = np.clip(hrr, 0, 1)
    return r * a * np.exp(b * r)


def effort_minutes(start_min: np.ndarray, dur_min: np.ndarray, mets: np.ndarray, nd: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Moderate (3.0–5.9 METs) and vigorous (≥ 6.0) minutes per day, and samples per day; each sample counts on its start day."""
    day = start_min // MINUTES_PER_DAY
    keep = (day >= 0) & (day < nd) & np.isfinite(mets) & (dur_min > 0)
    mod = keep & (mets >= MODERATE_MET) & (mets < VIGOROUS_MET)
    vig = keep & (mets >= VIGOROUS_MET)
    return (
        np.bincount(day[mod], dur_min[mod], minlength=nd),
        np.bincount(day[vig], dur_min[vig], minlength=nd),
        np.bincount(day[keep], minlength=nd).astype(float),
    )


def rest_hr_filled(rhr: np.ndarray, window: int = RHR_BASELINE_DAYS) -> np.ndarray:
    """The day's resting HR, or the median of the previous `window` days' values when it is missing."""
    out = rhr.astype(float).copy()
    for i in np.flatnonzero(~np.isfinite(rhr)):
        prev = rhr[max(0, i - window) : i]
        if np.isfinite(prev).any():
            out[i] = nanmedian(prev)
    return out


def hr_intensity_minutes(hr_days: np.ndarray, rest: np.ndarray, hrmax: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per day: minutes at moderate HRR, at vigorous HRR (≥ 60%, including ≥ 90%), and minutes with a sample and a known HRrest."""
    r = hrr_fraction(hr_days, rest[:, None], hrmax)
    ok = np.isfinite(r)
    mod = (ok & (r >= HRR_MODERATE) & (r < HRR_VIGOROUS)).sum(axis=1)
    vig = (ok & (r >= HRR_VIGOROUS)).sum(axis=1)
    return mod.astype(float), vig.astype(float), ok.sum(axis=1).astype(float)


def step_bands(age: int | None) -> list[tuple[str, int, int]]:
    """The Paluch 2022 plateau for this age, or both bands when the age is unknown."""
    return [(label, lo, hi) for label, lo, hi, a0, a1 in STEP_BANDS if age is None or ((a0 is None or age >= a0) and (a1 is None or age < a1))]


def weekly(
    weeks: Weeks,
    hr1: np.ndarray,
    worn: np.ndarray,
    rest: np.ndarray,
    effort: tuple[np.ndarray, np.ndarray, np.ndarray],
    workouts: Workouts,
    age: int | None,
    sex: TrimpSex | None,
) -> dict:
    """Everything the fitness chapter draws, per ISO week.

    `rest` is the filled resting HR per timeline day; `effort` is (moderate minutes, vigorous minutes, PhysicalEffort samples) per day.
    The watch logs effort all day while worn, so a week without a single sample is missing rather than zero.
    """
    nw = len(weeks)
    nd = rest.size
    a, b = (int(weeks.lo[0]), int(weeks.hi[-1])) if nw else (0, 0)

    mod_d, vig_d, samples = effort
    covered = weeks.sum(samples) > 0
    moderate = np.where(covered, weeks.sum(mod_d), np.nan)
    vigorous = np.where(covered, weeks.sum(vig_d), np.nan)

    hrmax = hr_max(age) if age is not None else None
    lo_m, hi_m = a * MINUTES_PER_DAY, b * MINUTES_PER_DAY
    hr_days = np.where(worn[lo_m:hi_m], hr1[lo_m:hi_m], np.nan).reshape(b - a, MINUTES_PER_DAY)
    hrr_mod = hrr_vig = hr_minutes = np.full(nw, np.nan)
    if hrmax is not None:
        m, v, n = (np.zeros(nd) for _ in range(3))
        m[a:b], v[a:b], n[a:b] = hr_intensity_minutes(hr_days, rest[a:b], hrmax)
        hr_minutes = weeks.sum(n)
        hrr_mod = np.where(hr_minutes > 0, weeks.sum(m), np.nan)
        hrr_vig = np.where(hr_minutes > 0, weeks.sum(v), np.nan)

    wk = weeks.of_days(workouts.start // MINUTES_PER_DAY) if len(workouts) else np.zeros(0, int)
    per_workout = np.full(len(workouts), np.nan)
    trimp = np.full(nw, np.nan)
    if hrmax is not None and sex is not None:
        load = trimp_per_minute(hrr_fraction(hr_days.ravel(), np.repeat(rest[a:b], MINUTES_PER_DAY), hrmax), sex)
        inside = np.zeros(load.size, bool)
        for i in np.flatnonzero(wk >= 0):
            s, e = max(int(workouts.start[i]), lo_m) - lo_m, min(int(workouts.end[i]), hi_m) - lo_m
            if e > s:
                seg = load[s:e]
                per_workout[i] = np.nansum(seg) if np.isfinite(seg).any() else np.nan
                inside[s:e] = True
        # Minutes covered by two overlapping workouts (say, the same session logged by two apps) count once in the week.
        by_day = np.nansum(np.where(inside, load, 0.0).reshape(b - a, MINUTES_PER_DAY), axis=1)
        trimp = weeks.sum(np.r_[np.zeros(a), by_day, np.zeros(nd - b)])

    strength = np.zeros(nw, dtype=int)
    is_strength = np.isin(workouts.activity, list(STRENGTH_TYPES))
    sel = (wk >= 0) & is_strength
    for k in np.unique(wk[sel]):
        strength[k] = np.unique(workouts.start[sel & (wk == k)] // MINUTES_PER_DAY).size

    lists: list[list[int]] = [[] for _ in range(nw)]
    for i in np.argsort(workouts.start, kind="stable"):
        if wk[i] >= 0:
            lists[wk[i]].append(int(i))

    return {
        "moderate": moderate,
        "vigorous": vigorous,
        "hrr_moderate": hrr_mod,
        "hrr_vigorous": hrr_vig,
        "hr_minutes": hr_minutes,
        "trimp": trimp,
        "strength_days": strength,
        "workouts": lists,
        "workout_trimp": per_workout,
        "workout_strength": is_strength,
        "hrmax": hrmax,
    }
