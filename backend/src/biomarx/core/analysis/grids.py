"""Minute-resolution grids every analysis reads from.

All arrays share the dataset Timeline: row i is calendar day `timeline.start + i`,
with one trailing row for the last night's spill-over.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cached_property

import numpy as np
from scipy.ndimage import maximum_filter1d

from biomarx.core.analysis._np import nanmean
from biomarx.core.domain import ASLEEP_CODES, MINUTES_PER_DAY, ActogramCode, SleepCode, Timeline

WEAR_WINDOW_MIN = 31
VALID_WEAR_FRACTION = 0.6


@dataclass(frozen=True)
class SleepSegments:
    """Staged sleep intervals of the best source per night, as grid minute indices."""

    night: np.ndarray  # int day index of the night date
    stage: np.ndarray  # SleepCode
    start: np.ndarray  # int minute index
    end: np.ndarray  # int minute index


@dataclass(frozen=True)
class Grids:
    timeline: Timeline
    hr1: np.ndarray  # float32 [rows*1440], NaN where no sample
    worn: np.ndarray  # bool [rows*1440]
    steps10: np.ndarray  # float32 [rows, 144]
    sleep: np.ndarray  # int8 [rows*1440] SleepCode

    @property
    def nd(self) -> int:
        return self.timeline.days

    @property
    def hr1_days(self) -> np.ndarray:
        return self.hr1[: self.nd * MINUTES_PER_DAY].reshape(self.nd, MINUTES_PER_DAY)

    @cached_property
    def asleep(self) -> np.ndarray:
        return np.isin(self.sleep, ASLEEP_CODES)

    @cached_property
    def hr5(self) -> np.ndarray:
        return nanmean(self.hr1_days.reshape(self.nd, 288, 5), axis=2).astype(np.float32)

    @cached_property
    def hr60(self) -> np.ndarray:
        return nanmean(self.hr5.reshape(self.nd, 24, 12), axis=2)

    @cached_property
    def steps60(self) -> np.ndarray:
        return self.steps10[: self.nd].reshape(self.nd, 24, 6).sum(axis=2)

    @cached_property
    def hr_coverage(self) -> np.ndarray:
        return np.isfinite(self.hr1_days).mean(axis=1)

    @cached_property
    def wear_fraction(self) -> np.ndarray:
        return self.worn[: self.nd * MINUTES_PER_DAY].reshape(self.nd, MINUTES_PER_DAY).mean(axis=1)

    @cached_property
    def valid_day(self) -> np.ndarray:
        return self.wear_fraction > VALID_WEAR_FRACTION

    def actogram(self) -> np.ndarray:
        """uint8 [nd, 1440] of ActogramCode, the merged wear and stage raster."""
        nd = self.nd
        stage = self.sleep[: nd * MINUTES_PER_DAY].reshape(nd, MINUTES_PER_DAY).astype(np.uint8)
        worn = self.worn[: nd * MINUTES_PER_DAY].reshape(nd, MINUTES_PER_DAY)
        img = np.where(worn, ActogramCode.AWAKE_WORN, ActogramCode.NOT_WORN).astype(np.uint8)
        img = np.where(stage > 0, stage + 1, img).astype(np.uint8)
        sparse = self.hr_coverage < 0.03
        img[sparse] = np.where(stage[sparse] > 0, stage[sparse] + 1, ActogramCode.NOT_WORN)
        return img


def build_grids(
    timeline: Timeline,
    hr_minutes: tuple[np.ndarray, np.ndarray],
    steps_bins: tuple[np.ndarray, np.ndarray],
    segments: SleepSegments,
) -> Grids:
    nm = timeline.minutes

    hr1 = np.full(nm, np.nan, dtype=np.float32)
    idx, val = hr_minutes
    keep = (idx >= 0) & (idx < nm)
    hr1[idx[keep]] = val[keep]

    worn = maximum_filter1d(np.isfinite(hr1).astype(np.uint8), size=WEAR_WINDOW_MIN, mode="constant", cval=0) > 0

    steps10 = np.zeros(timeline.rows * 144, dtype=np.float32)
    bidx, bval = steps_bins
    keep = (bidx >= 0) & (bidx < steps10.size)
    steps10[bidx[keep]] = bval[keep]

    return Grids(timeline, hr1, worn, steps10.reshape(timeline.rows, 144), paint_sleep(nm, segments))


def paint_sleep(nm: int, seg: SleepSegments) -> np.ndarray:
    """Paint stages minute by minute. Later stages overwrite earlier ones, Awake last."""
    out = np.zeros(nm, dtype=np.int8)
    a = np.clip(seg.start, 0, nm)
    b = np.clip(seg.end, 0, nm)
    for stage in (SleepCode.CORE, SleepCode.REM, SleepCode.DEEP, SleepCode.AWAKE):
        sel = seg.stage == stage
        for s, e in zip(a[sel], b[sel], strict=True):
            if e > s:
                out[s : e + 1] = stage
    return out
