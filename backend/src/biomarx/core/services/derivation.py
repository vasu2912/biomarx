"""Turns raw records into the grids, nights and daily table every view reads."""

from __future__ import annotations

import numpy as np

from biomarx.core.analysis import circadian, sleep
from biomarx.core.analysis.derived import Derived
from biomarx.core.analysis.grids import build_grids
from biomarx.core.domain import Timeline
from biomarx.core.metrics import DAILY_KEYS, GAIT_TYPES
from biomarx.core.ports import RecordReader


class NoHeartRateData(ValueError):
    pass


def derive(reader: RecordReader) -> Derived:
    span = reader.heart_rate_span()
    if span is None:
        raise NoHeartRateData("The export contains no heart-rate samples, so there is no timeline to analyse.")
    first, last = span
    timeline = Timeline(first, (last - first).days + 1)
    origin = timeline.start
    nd = timeline.days

    segments = reader.sleep_segments(origin)
    grids = build_grids(timeline, reader.heart_rate_minutes(origin), reader.steps_bins(origin), segments)
    nights = sleep.main_episodes(grids, segments)
    _add_nocturnal_samples(nights, reader, origin)

    daily: dict[str, np.ndarray] = {k: np.full(nd, np.nan) for k in DAILY_KEYS}

    steps = grids.steps10[:nd].sum(axis=1).astype(float)
    steps[~grids.valid_day & (steps == 0)] = np.nan
    daily["steps"] = steps
    daily["wear"] = grids.wear_fraction * 100
    _scatter(daily["active_kcal"], *reader.daily_best_source("ActiveEnergyBurned", "sum", origin))

    rhr = np.full(nd + 1, np.nan)
    _scatter(rhr, *reader.daily_best_source("RestingHeartRate", "mean", origin))
    nights.cols["rhr_next"] = rhr[nights.night + 1]

    for key, col in nights.cols.items():
        if key in daily:
            daily[key][nights.night] = col

    daily["sri"] = sleep.sleep_regularity(grids)
    daily.update(circadian.cosinor(grids.hr5))
    daily.update(circadian.sliding_npcra(grids.steps60, grids.valid_day, "steps", with_timing=True))
    hr_hourly, hr_ok = circadian.hourly_hr_for_npcra(grids.hr60)
    daily.update(circadian.sliding_npcra(hr_hourly, hr_ok, "hr", with_timing=False))

    for key, record_type in GAIT_TYPES.items():
        idx, val = reader.daily_median(record_type, origin)
        if record_type.endswith("Percentage") and val.size and np.nanmax(val) <= 1.01:
            val = val * 100
        _scatter(daily[key], idx, val)

    return Derived(grids, nights, daily)


def _add_nocturnal_samples(nights: sleep.Nights, reader: RecordReader, origin) -> None:
    hrv = reader.samples("HeartRateVariabilitySDNN", origin)
    resp = reader.samples("RespiratoryRate", origin)
    spo2_m, spo2_v = reader.samples("OxygenSaturation", origin)
    if spo2_v.size and np.nanmax(spo2_v) <= 1.01:
        spo2_v = spo2_v * 100
    nights.cols["hrv"] = sleep.window_stat(nights, *hrv, np.mean)
    nights.cols["resp"] = sleep.window_stat(nights, *resp, np.mean)
    nights.cols["spo2"] = sleep.window_stat(nights, spo2_m, spo2_v, np.mean)
    nights.cols["spo2_p5"] = sleep.window_stat(nights, spo2_m, spo2_v, lambda v: np.percentile(v, 5))


def _scatter(target: np.ndarray, idx: np.ndarray, val: np.ndarray) -> None:
    keep = (idx >= 0) & (idx < target.size)
    target[idx[keep]] = val[keep]
