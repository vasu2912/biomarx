from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from biomarx.core.analysis._np import nanmedian
from biomarx.core.analysis.grids import Grids, SleepSegments
from biomarx.core.domain import MINUTES_PER_DAY, SleepCode

EPISODE_GAP_MIN = 60
MIN_MAIN_SLEEP_H = 3.0
ARCHITECTURE_MIN = 600
FREE_NIGHTS = (4, 5)  # Friday and Saturday nights, Monday = 0
STAGE_ORDER = (SleepCode.AWAKE, SleepCode.CORE, SleepCode.REM, SleepCode.DEEP)


@dataclass(frozen=True)
class Nights:
    """One row per main sleep episode, columnar. `night` is the day index of night D."""

    night: np.ndarray
    i0: np.ndarray
    i1: np.ndarray
    cols: dict[str, np.ndarray]

    def __len__(self) -> int:
        return self.night.size

    def take(self, mask: np.ndarray) -> Nights:
        return Nights(self.night[mask], self.i0[mask], self.i1[mask], {k: v[mask] for k, v in self.cols.items()})

    def in_days(self, lo: int, hi: int) -> Nights:
        return self.take((self.night >= lo) & (self.night < hi))


def main_episodes(grids: Grids, seg: SleepSegments) -> Nights:
    """Main sleep episode per night: the cluster of asleep segments (gaps <= 60 min) with most sleep."""
    nm = grids.timeline.minutes
    sleep = grids.sleep
    asleep_cum = np.concatenate(([0], np.cumsum(grids.asleep, dtype=np.int64)))
    rows: list[tuple[int, int, int]] = []
    order = np.lexsort((seg.start, seg.night))
    night, stage, start, end = seg.night[order], seg.stage[order], seg.start[order], seg.end[order]
    bounds = np.flatnonzero(np.diff(night)) + 1
    for lo, hi in zip(np.r_[0, bounds], np.r_[bounds, night.size], strict=True):
        n = int(night[lo])
        if n < 0 or n >= grids.nd:
            continue
        sel = stage[lo:hi] != SleepCode.AWAKE
        s_, e_ = start[lo:hi][sel], end[lo:hi][sel]
        if s_.size == 0:
            continue
        best: tuple[int, int, int] | None = None
        cs, ce = int(s_[0]), int(e_[0])
        for a, b in [*zip(s_[1:].tolist(), e_[1:].tolist(), strict=True), (None, None)]:
            if a is not None and a - ce <= EPISODE_GAP_MIN:
                ce = max(ce, b)
                continue
            i0, i1 = max(cs, 0), min(ce, nm)
            tst = int(asleep_cum[max(i1, i0)] - asleep_cum[i0])
            if best is None or tst > best[2]:
                best = (i0, i1, tst)
            if a is not None:
                cs, ce = a, b
        assert best is not None
        rows.append((n, best[0], best[1]))

    arr = np.array(rows, dtype=np.int64).reshape(-1, 3)
    n_idx, i0, i1 = arr[:, 0], arr[:, 1], arr[:, 2]
    counts = {code: np.zeros(len(arr)) for code in SleepCode if code != SleepCode.NONE}
    hr_mean = np.full(len(arr), np.nan)
    hr_p5 = np.full(len(arr), np.nan)
    day_hr = np.full(len(arr), np.nan)
    for k, (n, a, b) in enumerate(arr):
        seg_k = sleep[a:b]
        for code in counts:
            counts[code][k] = np.count_nonzero(seg_k == code)
        h = grids.hr1[a:b]
        h = h[np.isfinite(h)]
        if h.size > 30:
            hr_mean[k], hr_p5[k] = h.mean(), np.percentile(h, 5)
        base = n * MINUTES_PER_DAY
        w = grids.hr1[base + 600 : base + 1200]
        w = w[np.isfinite(w)]
        if w.size > 120:
            day_hr[k] = w.mean()

    tst_min = counts[SleepCode.CORE] + counts[SleepCode.REM] + counts[SleepCode.DEEP]
    onset_h = (i0 - n_idx * MINUTES_PER_DAY) / 60
    offset_h = (i1 - n_idx * MINUTES_PER_DAY) / 60
    with np.errstate(divide="ignore", invalid="ignore"):
        cols = {
            "onset_h": onset_h,
            "offset_h": offset_h,
            "mid_h": (onset_h + offset_h) / 2,
            "tib": (i1 - i0) / 60,
            "tst": tst_min / 60,
            "eff": tst_min / np.maximum(i1 - i0, 1) * 100,
            "waso": counts[SleepCode.AWAKE],
            "deep_h": counts[SleepCode.DEEP] / 60,
            "core_h": counts[SleepCode.CORE] / 60,
            "rem_h": counts[SleepCode.REM] / 60,
            "deep_pct": counts[SleepCode.DEEP] / tst_min * 100,
            "rem_pct": counts[SleepCode.REM] / tst_min * 100,
            "night_hr": hr_mean,
            "night_hr_min": hr_p5,
            "day_hr": day_hr,
            "dip": (day_hr - hr_mean) / day_hr * 100,
        }
    nights = Nights(n_idx, i0, i1, cols)
    return nights.take(nights.cols["tst"] >= MIN_MAIN_SLEEP_H)


def window_stat(nights: Nights, minutes: np.ndarray, values: np.ndarray, fn) -> np.ndarray:
    """Apply `fn` to the samples whose start minute falls inside each main episode."""
    out = np.full(len(nights), np.nan)
    if minutes.size == 0:
        return out
    order = np.argsort(minutes, kind="stable")
    m, v = minutes[order], values[order]
    lo = np.searchsorted(m, nights.i0, side="left")
    hi = np.searchsorted(m, nights.i1, side="left")
    for k, (a, b) in enumerate(zip(lo, hi, strict=True)):
        if b - a >= 2:
            out[k] = fn(v[a:b])
    return out


def sleep_regularity(grids: Grids) -> np.ndarray:
    """Sleep Regularity Index per day (Phillips 2017): 200 * P(same state 24 h apart) - 100."""
    nd = grids.nd
    s = grids.asleep[: grids.timeline.rows * MINUTES_PER_DAY].reshape(grids.timeline.rows, MINUTES_PER_DAY)
    valid = grids.valid_day
    sri = np.full(nd, np.nan)
    agree = (s[: nd - 1] == s[1:nd]).mean(axis=1)
    both = valid[: nd - 1] & valid[1:nd]
    sri[: nd - 1] = np.where(both, 200 * agree - 100, np.nan)
    return sri


def architecture(grids: Grids, nights: Nights) -> dict:
    """Stage probability by minute since onset, and the first-order stage transition matrix."""
    k = len(nights)
    mat = np.zeros((k, ARCHITECTURE_MIN), dtype=np.int8)
    trans = np.zeros((4, 4))
    for r, (a, b) in enumerate(zip(nights.i0, nights.i1, strict=True)):
        seg = grids.sleep[a : a + ARCHITECTURE_MIN].copy()
        seg[b - a :] = 0
        mat[r, : seg.size] = seg
        seq = grids.sleep[a:b]
        seq = seq[seq > 0]
        if seq.size < 2:
            continue
        runs = seq[np.r_[True, seq[1:] != seq[:-1]]]
        np.add.at(trans, (runs[:-1] - 1, runs[1:] - 1), 1)
    with np.errstate(invalid="ignore", divide="ignore"):
        p = trans / trans.sum(axis=1, keepdims=True)
    prob = {code.name.lower(): (mat == code).mean(axis=0) if k else np.zeros(ARCHITECTURE_MIN) for code in STAGE_ORDER}
    return {
        "nights": k,
        "minutes": ARCHITECTURE_MIN,
        "probability": prob,
        "order": [c.name.lower() for c in STAGE_ORDER],
        "transitions": p,
        "transition_counts": trans,
    }


def circular_mean_hour(hours: np.ndarray) -> tuple[float, float]:
    th = (hours % 24) / 24 * 2 * np.pi
    z = np.mean(np.exp(1j * th))
    return float((np.angle(z) / (2 * np.pi) * 24) % 24), float(np.abs(z))


def chronotype(nights: Nights, weekday: np.ndarray) -> dict:
    """MCTQ-style chronotype from main episodes. `weekday` is Monday=0 for each night date."""
    c = nights.cols
    hist, means = {}, {}
    for key, col in (("onset", "onset_h"), ("wake", "offset_h"), ("mid", "mid_h")):
        v = c[col][np.isfinite(c[col])]
        hist[key] = np.histogram(v % 24, bins=96, range=(0, 24))[0]
        means[key] = circular_mean_hour(v) if v.size else (np.nan, np.nan)
    free = np.isin(weekday, FREE_NIGHTS)
    msf, msw = nanmedian(c["mid_h"][free]), nanmedian(c["mid_h"][~free])
    sdf = np.nanmean(c["tst"][free]) if free.any() else np.nan
    sdw = np.nanmean(c["tst"][~free]) if (~free).any() else np.nan
    msfsc = msf - (sdf - sdw) / 2 if sdf > sdw else msf
    by_day = [c["mid_h"][(weekday == d) & np.isfinite(c["mid_h"])] for d in range(7)]
    return {
        "histograms": hist,
        "circular": means,
        "weekday_mid": by_day,
        "msw": msw,
        "msf": msf,
        "msfsc": msfsc,
        "social_jetlag_min": abs(msf - msw) * 60,
    }
