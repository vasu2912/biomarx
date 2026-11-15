"""Range queries over the derived dataset. Everything here is read-only and memoised per dataset version."""

from __future__ import annotations

import datetime as dt
from collections.abc import Callable
from dataclasses import dataclass
from functools import wraps
from typing import Literal

import numpy as np

from biomarx.core.analysis import activity, baseline, circadian, environment, exposures, fitness, patterns, provenance, sleep
from biomarx.core.analysis._np import nanmedian
from biomarx.core.analysis.derived import Derived
from biomarx.core.analysis.ecg import analyse_ecg
from biomarx.core.domain import Dataset, DayRange, Timeline
from biomarx.core.metrics import CORRELATED, DAILY_KEYS
from biomarx.core.ports import Store
from biomarx.core.services.derivation import read_daylight

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

    @memo
    def fitness(self, w: Window, age: int | None, sex: fitness.TrimpSex | None) -> dict:
        """Weekly load and activity. Keyed on age and sex too: the profile can change without a re-derive."""
        g = self._derived().grids
        rest, effort, workouts = self._fitness_inputs()
        weeks = fitness.Weeks.covering(w.timeline.start, w.lo, w.hi, w.timeline.days)
        out = fitness.weekly(weeks, g.hr1, g.worn, rest, effort, workouts, age, sex)
        return {**out, "weeks": weeks, "workout_table": workouts, "step_bands": fitness.step_bands(age)}

    def _fitness_inputs(self) -> tuple[np.ndarray, tuple, fitness.Workouts]:
        """Record-level inputs read once per dataset version: filled resting HR per day, effort minutes per day, workouts."""
        key = ("fitness_inputs", self._version)
        if key not in self._memo:
            origin, nd = self._derived().grids.timeline.start, self._derived().grids.timeline.days
            with self.store.records() as r:
                idx, val = r.daily_best_source("RestingHeartRate", "mean", origin)
                start, dur, mets = r.intervals("PhysicalEffort", origin)
                workouts = r.workouts(origin)
            rhr = np.full(nd, np.nan)
            keep = (idx >= 0) & (idx < nd)
            rhr[idx[keep]] = val[keep]
            self._memo[key] = (fitness.rest_hr_filled(rhr), fitness.effort_minutes(start, dur, mets, nd), workouts)
        return self._memo[key]  # type: ignore[return-value]

    @memo
    def baseline(self, w: Window) -> dict:
        """Each night of the range against its own trailing baseline, which may reach back before the range."""
        d = self._derived()
        nd = d.grids.timeline.days
        series = {k: baseline.per_day(d.nights, d.nights.cols[k], nd) for k in baseline.SIGNALS}
        concerns = dict(baseline.SIGNALS)
        temp = self._wrist_temperature()
        if temp is not None:
            key, concern = baseline.WRIST_TEMP
            series[key], concerns[key] = temp, concern
        out = {k: tuple(a[w.lo : w.hi] for a in (x, *baseline.trailing_robust_z(x))) for k, x in series.items()}
        return {"signals": out, "concerns": concerns, "concurrent": baseline.concurrent({k: v[3] for k, v in out.items()}, concerns)}

    def _wrist_temperature(self) -> np.ndarray | None:
        """Sleeping wrist temperature per night D, or None when the export has none. Read once per dataset version."""
        key = ("wrist_temp", self._version)
        if key not in self._memo:
            d = self._derived()
            with self.store.records() as r:
                start, dur, val = r.intervals("AppleSleepingWristTemperature", d.grids.timeline.start)
            # One sample spans the night; its midpoint places it inside the main episode.
            self._memo[key] = baseline.night_mean(d.nights, start + dur / 2, val, d.grids.timeline.days) if val.size else None
        return self._memo[key]  # type: ignore[return-value]

    @memo
    def seven_hours(self, w: Window) -> dict:
        """Weekly share of nights at the 7 h floor, and the running 14-night shortfall below it."""
        all_n = self._derived().nights
        order = np.argsort(all_n.night, kind="stable")
        night, tst = all_n.night[order], all_n.cols["tst"][order]
        short = sleep.shortfall(tst)
        weeks = fitness.Weeks.covering(w.timeline.start, w.lo, w.hi, w.timeline.days)
        counts, share = sleep.floor_share(weeks.lo, weeks.hi, night, tst)
        inside = (night >= w.lo) & (night < w.hi)
        shortfall = np.full(w.hi - w.lo, np.nan)
        shortfall[night[inside] - w.lo] = short[inside]
        return {
            "weeks": weeks,
            "week_nights": counts,
            "week_share": share,
            "shortfall": shortfall,
            "share": sleep.floor_share(np.array([w.lo]), np.array([w.hi]), night, tst)[1][0],
            "shortfall_median": nanmedian(short[inside]) if np.isfinite(short[inside]).any() else np.nan,
        }

    def exposure_catalogue(self, age: int | None, sex: fitness.TrimpSex | None) -> dict[str, str | None]:
        """Each exposure's key with None when it can be computed, or the reason it cannot."""
        out: dict[str, str | None] = {}
        for k in exposures.EXPOSURES:
            try:
                self._exposure_values(k, age, sex)
                out[k] = None
            except exposures.Unavailable as e:
                out[k] = str(e)
        return out

    @memo
    def exposure(self, w: Window, key: str, age: int | None, sex: fitness.TrimpSex | None) -> dict:
        """An available exposure's per-night values and statistics over the range's nights."""
        e = exposures.EXPOSURES[key]
        all_n = self._derived().nights
        inside = (all_n.night >= w.lo) & (all_n.night < w.hi)
        n = all_n.take(inside)
        x = self._exposure_values(key, age, sex)[inside]
        ys = {o.key: n.cols[o.key] for o in exposures.OUTCOMES}
        stats = exposures.assess_groups(x, ys, len(e.groups)) if e.kind == "groups" else exposures.assess_continuous(x, ys)
        return {"nights": n, "values": x, "stats": stats}

    def _exposure_values(self, key: str, age: int | None, sex: fitness.TrimpSex | None) -> np.ndarray:
        """Per night of the whole dataset, so night D−1 and the person's median workout are never cut off by the range."""
        mkey = ("exposure", self._version, key, age, sex)
        if mkey not in self._memo:
            try:
                self._memo[mkey] = exposures.EXPOSURES[key].values(_ExposureInputs(self, age, sex))
            except exposures.Unavailable as e:
                self._memo[mkey] = e
        got = self._memo[mkey]
        if isinstance(got, exposures.Unavailable):
            raise got
        return got  # type: ignore[return-value]

    def _daylight(self) -> exposures.Daylight:
        key = ("daylight", self._version)
        if key not in self._memo:
            with self.store.records() as r:
                self._memo[key] = read_daylight(r, self._derived().grids.timeline)
        return self._memo[key]  # type: ignore[return-value]

    @memo
    def sound(self, w: Window) -> dict:
        """Weekly noise dose of headphone and environmental audio over the ISO weeks covering the range."""
        weeks = fitness.Weeks.covering(w.timeline.start, w.lo, w.hi, w.timeline.days)
        out: dict = {"weeks": weeks}
        for key, (start, dur, level) in self._audio().items():
            out[key] = environment.weekly_dose(start, dur, level, weeks, w.timeline.days)
        return out

    def _audio(self) -> dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]]:
        key = ("audio", self._version)
        if key not in self._memo:
            origin = self._derived().grids.timeline.start
            with self.store.records() as r:
                self._memo[key] = {k: r.intervals(t, origin) for k, t in environment.AUDIO_TYPES.items()}
        return self._memo[key]  # type: ignore[return-value]

    def seasons(self) -> dict[str, environment.Season]:
        """Week-of-year profiles over the whole dataset; the range does not apply."""
        key = ("seasons", self._version)
        if key not in self._memo:
            d = self._derived()
            iso_year, iso_week = environment.iso_weeks(d.grids.timeline.start, d.grids.timeline.days)
            self._memo[key] = {k: environment.season(d.daily[k], iso_year, iso_week) for k in environment.SEASON_KEYS}
        return self._memo[key]  # type: ignore[return-value]

    def sources(self, w: Window) -> tuple[list[str], dict[str, np.ndarray]]:
        """Sources ordered over the whole dataset, so a source keeps its color across ranges; codes per family for the range."""
        key = ("sources", self._version)
        if key not in self._memo:
            tl = self._derived().grids.timeline
            with self.store.records() as r:
                best = {f.key: r.best_source_by_day(f.record_type, f.rule, tl.start) for f in provenance.FAMILIES}
            self._memo[key] = provenance.source_codes(best, tl.days)
        names, codes = self._memo[key]  # type: ignore[misc]
        return names, {k: c[w.lo : w.hi] for k, c in codes.items()}

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


class _ExposureInputs:
    """What an exposure may read, fetched only when it asks."""

    def __init__(self, ins: InsightService, age: int | None, sex: fitness.TrimpSex | None) -> None:
        self.ins, self.age, self.sex = ins, age, sex
        self.nights = ins._derived().nights

    def workouts(self) -> fitness.Workouts:
        return self.ins._fitness_inputs()[2]

    def workout_trimp(self) -> np.ndarray:
        if self.age is None or self.sex is None:
            raise exposures.Unavailable("A hard workout is weighed by training load, which needs your birth date and sex. Add them in Fitness.")
        tl = self.ins._derived().grids.timeline
        return self.ins.fitness(self.ins.window(tl.start, tl.end), self.age, self.sex)["workout_trimp"]

    def daylight(self) -> exposures.Daylight:
        return self.ins._daylight()
