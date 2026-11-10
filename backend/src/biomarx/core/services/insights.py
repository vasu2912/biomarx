"""Range queries over the derived dataset. Everything here is read-only and memoised per dataset version."""

from __future__ import annotations

import datetime as dt
from collections.abc import Callable
from dataclasses import dataclass
from functools import wraps
from typing import Literal

import numpy as np

from biomarx.core.analysis import activity, circadian, patterns, sleep
from biomarx.core.analysis._np import nanmedian
from biomarx.core.analysis.derived import Derived
from biomarx.core.analysis.ecg import analyse_ecg
from biomarx.core.domain import Dataset, DayRange, Timeline
from biomarx.core.metrics import CORRELATED, DAILY_KEYS
from biomarx.core.ports import Store

RasterName = Literal["sleep", "hr5", "steps10"]


class NoDataset(LookupError):
    pass


@dataclass(frozen=True)
class Window:
    """A requested range resolved against the timeline, with grid row bounds."""

    range: DayRange
    lo: int
    hi: int
    timeline: Timeline

    def day(self, i: int) -> dt.date:
        return self.timeline.day(i)


@dataclass(frozen=True)
class Raster:
    data: bytes
    rows: int
    cols: int
    dtype: str
    start: dt.date


def memo(fn: Callable) -> Callable:
    @wraps(fn)
    def wrapper(self: InsightService, w: Window, *args):
        key = (fn.__name__, self._version, w.lo, w.hi, args)
        if key not in self._memo:
            if len(self._memo) > 256:
                self._memo.clear()
            self._memo[key] = fn(self, w, *args)
        return self._memo[key]

    return wrapper


class InsightService:
    def __init__(self, store: Store) -> None:
        self.store = store
        self._memo: dict[tuple, object] = {}
        self._version = ""

    def dataset(self) -> Dataset | None:
        return self.store.dataset()

    def _derived(self) -> Derived:
        d = self.store.derived()
        ds = self.store.dataset()
        if d is None or ds is None:
            raise NoDataset("No dataset imported yet.")
        self._version = ds.version
        return d

    def window(self, start: dt.date | None, end: dt.date | None) -> Window:
        tl = self._derived().grids.timeline
        default = tl.default_range()
        if start and not end:
            end = max(default.end, start + dt.timedelta(days=1))
        r = tl.clamp(DayRange(start or (end - dt.timedelta(days=365) if end else default.start), end or default.end))
        return Window(r, tl.index(r.start), tl.index(r.end), tl)

    # ------------------------------------------------------------------ tables

    def daily(self, w: Window, keys: tuple[str, ...] = DAILY_KEYS) -> dict[str, np.ndarray]:
        d = self._derived().daily
        return {k: d[k][w.lo : w.hi] for k in keys}

    def days(self, w: Window) -> list[dt.date]:
        return [w.day(i) for i in range(w.lo, w.hi)]

    def nights(self, w: Window) -> sleep.Nights:
        return self._derived().nights.in_days(w.lo, w.hi)

    def raster(self, w: Window, name: RasterName) -> Raster:
        g = self._derived().grids
        if name == "sleep":
            a = g.actogram()[w.lo : w.hi]
        elif name == "hr5":
            a = g.hr5[w.lo : w.hi]
        else:
            a = g.steps10[w.lo : min(w.hi + 1, g.timeline.rows)]
        a = np.ascontiguousarray(a)
        return Raster(a.tobytes(), a.shape[0], a.shape[1], a.dtype.name, w.range.start)

    # ------------------------------------------------------------------ analyses

    @memo
    def summary(self, w: Window) -> dict[str, float | None]:
        n = self.nights(w).cols
        d = self.daily(w)
        chrono = self.chronotype(w)
        per = self.periodogram(w)
        valid = self._derived().grids.valid_day[w.lo : w.hi]
        med = lambda a: nanmedian(a) if np.isfinite(a).any() else np.nan  # noqa: E731
        mean = lambda a: np.nanmean(a) if np.isfinite(a).any() else np.nan  # noqa: E731
        return {
            "nights": float(len(self.nights(w))),
            "valid_days": float(valid.sum()),
            "tst": med(n["tst"]),
            "onset_h": med(n["onset_h"]),
            "offset_h": med(n["offset_h"]),
            "mid_h": med(n["mid_h"]),
            "eff": med(n["eff"]),
            "deep_pct": med(n["deep_pct"]),
            "rem_pct": med(n["rem_pct"]),
            "sri": mean(d["sri"]),
            "dip": med(n["dip"]),
            "hrv": med(n["hrv"]),
            "rhr_next": med(n["rhr_next"]),
            "night_hr": med(n["night_hr"]),
            "spo2": med(n["spo2"]),
            "resp": med(n["resp"]),
            "steps": med(d["steps"][valid]),
            "active_kcal": med(d["active_kcal"]),
            "hr_amp": med(np.where(d["hr_r2"] > circadian.COSINOR_MIN_R2, d["hr_amp"], np.nan)),
            "hr_acro": med(np.where(d["hr_r2"] > circadian.COSINOR_MIN_R2, d["hr_acro"], np.nan)),
            "is_steps": med(d["is_steps"]),
            "ra_steps": med(d["ra_steps"]),
            "is_hr": med(d["is_hr"]),
            "social_jetlag_min": chrono["social_jetlag_min"],
            "msw": chrono["msw"],
            "msf": chrono["msf"],
            "msfsc": chrono["msfsc"],
            "dominant_hr_period": per["dominant_hr_period"],
            "walking_speed": med(d["walking_speed"]),
        }

    @memo
    def architecture(self, w: Window) -> dict:
        return sleep.architecture(self._derived().grids, self.nights(w))

    @memo
    def chronotype(self, w: Window) -> dict:
        n = self.nights(w)
        weekday = np.array([w.day(int(i)).weekday() for i in n.night], dtype=int)
        return sleep.chronotype(n, weekday)

    @memo
    def periodogram(self, w: Window) -> dict:
        g = self._derived().grids
        return circadian.periodogram(g.hr60[w.lo : w.hi], g.steps60[w.lo : w.hi], g.valid_day[w.lo : w.hi])

    @memo
    def correlation(self, w: Window) -> dict:
        d = self.daily(w, CORRELATED)
        return patterns.correlation(d, patterns.usable_metrics(d, CORRELATED, w.hi - w.lo))

    @memo
    def state(self, w: Window) -> dict:
        corr = self.correlation(w)
        d = self.daily(w, CORRELATED)
        return {"metrics": corr["metrics"], "z": patterns.robust_state(d, corr["metrics"])}

    @memo
    def hr_activity(self, w: Window) -> dict:
        g = self._derived().grids
        months = []
        cur = w.range.start.replace(day=1)
        while cur < w.range.end:
            nxt = (cur + dt.timedelta(days=32)).replace(day=1)
            months.append((cur.strftime("%Y-%m"), w.timeline.index(cur), w.timeline.index(nxt)))
            cur = nxt
        return {
            "dose_response": activity.hr_vs_steps(g, w.lo, w.hi),
            "ridgeline": activity.monthly_ridgeline(g, w.lo, w.hi, months),
        }

    # ------------------------------------------------------------------ ecg

    def ecg(self, ecg_id: str) -> tuple[object, dict] | None:
        rec = next((r for r in self.store.ecg_recordings() if r.id == ecg_id), None)
        return None if rec is None else (rec, self._ecg(ecg_id))

    def _ecg(self, ecg_id: str) -> dict:
        ds = self.store.dataset()
        key = ("ecg", ds.version if ds else "", ecg_id)
        if key not in self._memo:
            rec = next(r for r in self.store.ecg_recordings() if r.id == ecg_id)
            self._memo[key] = analyse_ecg(rec.microvolts, rec.sample_rate)
        return self._memo[key]  # type: ignore[return-value]
