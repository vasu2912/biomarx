"""Light and sound: the weekly noise dose, and the year as one person's data has lived it.

Noise dose follows ITU-T H.870 (2022) and the WHO safe-listening standard: an adult's weekly allowance is 1.6 Pa²h, the energy of
80 dBA for 40 h, traded at 3 dB per doubling. Seasons are descriptive statistics only: per ISO week of the year, the median
across years of each year's weekly median.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

import numpy as np

from biomarx.core.analysis._np import nanmedian
from biomarx.core.analysis.fitness import Weeks
from biomarx.core.domain import MINUTES_PER_DAY

REFERENCE_DB = 80.0
ALLOWANCE_HOURS = 40.0
ISO_WEEKS = 53

AUDIO_TYPES = {"headphone": "HeadphoneAudioExposure", "environmental": "EnvironmentalAudioExposure"}
SEASON_KEYS = ("daylight", "onset_h", "mid_h", "tst", "rhr_next")


def dose_percent(hours: np.ndarray, level_db: np.ndarray) -> np.ndarray:
    """Share of the weekly allowance: hours × 10^((L − 80)/10) / 40 × 100, the level taken as the LAeq over those hours."""
    return np.asarray(hours, dtype=float) * 10 ** ((np.asarray(level_db, dtype=float) - REFERENCE_DB) / 10) / ALLOWANCE_HOURS * 100


def weekly_dose(start_min: np.ndarray, dur_min: np.ndarray, level_db: np.ndarray, weeks: Weeks, nd: int) -> tuple[np.ndarray, np.ndarray]:
    """Dose % and sample count per week; each sample counts in the week of its start day."""
    day = start_min // MINUTES_PER_DAY
    keep = (day >= 0) & (day < nd) & np.isfinite(level_db) & (dur_min > 0)
    dose = np.bincount(day[keep], dose_percent(dur_min[keep] / 60, level_db[keep]), minlength=nd)
    n = np.bincount(day[keep], minlength=nd).astype(float)
    return weeks.sum(dose), weeks.sum(n)


@dataclass(frozen=True)
class Season:
    """Per ISO week 1–53 (index 0–52): median, quartiles across years (NaN under two years) and the number of years."""

    median: np.ndarray
    q25: np.ndarray
    q75: np.ndarray
    years: np.ndarray


def iso_weeks(origin: dt.date, nd: int) -> tuple[np.ndarray, np.ndarray]:
    """ISO year and week number of each day index."""
    cal = [(origin + dt.timedelta(days=i)).isocalendar() for i in range(nd)]
    return np.array([c[0] for c in cal]), np.array([c[1] for c in cal])


# A week's median from one or two days is one day's reading, not that week's typical value.
MIN_DAYS_PER_WEEK = 3


def season(values: np.ndarray, iso_year: np.ndarray, iso_week: np.ndarray) -> Season:
    """The median of each (ISO year, week) with at least MIN_DAYS_PER_WEEK values, then per week of the year across years."""
    ok = np.isfinite(values)
    by_week: list[list[float]] = [[] for _ in range(ISO_WEEKS)]
    for y in np.unique(iso_year):
        for w in range(1, ISO_WEEKS + 1):
            v = values[ok & (iso_year == y) & (iso_week == w)]
            if v.size >= MIN_DAYS_PER_WEEK:
                by_week[w - 1].append(float(np.median(v)))
    med, q25, q75, n = (np.full(ISO_WEEKS, np.nan) for _ in range(4))
    for k, v in enumerate(by_week):
        n[k] = len(v)
        if v:
            med[k] = nanmedian(np.array(v))
        if len(v) >= 2:
            q25[k], q75[k] = np.percentile(v, [25, 75])
    return Season(med, q25, q75, n.astype(int))
