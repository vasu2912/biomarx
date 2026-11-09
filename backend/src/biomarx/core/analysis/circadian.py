from __future__ import annotations

import numpy as np
from scipy import signal

from biomarx.core.analysis._np import nanmean

OMEGA_24H = 2 * np.pi / 24
COSINOR_MIN_COVERAGE = 0.4
COSINOR_MIN_R2 = 0.15
NPCRA_HALF_WINDOW = 7
NPCRA_MIN_DAYS = 7
HR_HOURLY_MIN_COVERAGE = 0.9


def cosinor(hr5: np.ndarray) -> dict[str, np.ndarray]:
    """Single-component 24 h cosinor on a 3-day window of 5-min HR centred on each day.

    HR(t) = MESOR + A*cos(2*pi*t/24 - phi). t is hours from midnight of the window's
    first day, so the acrophase reads as clock time.
    """
    nd = hr5.shape[0]
    out = {k: np.full(nd, np.nan) for k in ("hr_mesor", "hr_amp", "hr_acro", "hr_r2")}
    for d in range(nd):
        a, b = max(d - 1, 0), min(d + 2, nd)
        y = hr5[a:b].ravel().astype(np.float64)
        t = np.arange(y.size) * 5 / 60
        m = np.isfinite(y)
        if m.mean() < COSINOR_MIN_COVERAGE:
            continue
        ym, tm = y[m], t[m]
        x = np.c_[np.ones(tm.size), np.cos(OMEGA_24H * tm), np.sin(OMEGA_24H * tm)]
        beta, *_ = np.linalg.lstsq(x, ym, rcond=None)
        resid = ym - x @ beta
        out["hr_mesor"][d] = beta[0]
        out["hr_amp"][d] = np.hypot(beta[1], beta[2])
        out["hr_acro"][d] = (np.arctan2(beta[2], beta[1]) / OMEGA_24H) % 24
        out["hr_r2"][d] = 1 - np.sum(resid**2) / np.sum((ym - ym.mean()) ** 2)
    return out


def npcra(x: np.ndarray) -> tuple[float, float, float, float, float]:
    """Van Someren non-parametric rhythm metrics on a days x 24 hourly matrix."""
    v = x.ravel()
    n, mean = v.size, v.mean()
    den = np.sum((v - mean) ** 2)
    prof = x.mean(axis=0)
    is_ = n * np.sum((prof - mean) ** 2) / (24 * den)
    iv = n * np.sum(np.diff(v) ** 2) / ((n - 1) * den)
    wrap = np.r_[prof, prof]
    m10 = np.array([wrap[i : i + 10].mean() for i in range(24)])
    l5 = np.array([wrap[i : i + 5].mean() for i in range(24)])
    top, low = m10.max(), l5.min()
    return is_, iv, (top - low) / (top + low), float(m10.argmax()), float(l5.argmin())


def sliding_npcra(hourly: np.ndarray, ok: np.ndarray, suffix: str, with_timing: bool) -> dict[str, np.ndarray]:
    nd = hourly.shape[0]
    keys = [f"is_{suffix}", f"iv_{suffix}", f"ra_{suffix}", "m10_on", "l5_on"]
    out = {k: np.full(nd, np.nan) for k in keys}
    idx = np.arange(nd)
    for d in range(nd):
        rows = idx[max(0, d - NPCRA_HALF_WINDOW) : min(nd, d + NPCRA_HALF_WINDOW)]
        rows = rows[ok[rows]]
        if rows.size < NPCRA_MIN_DAYS:
            continue
        for k, v in zip(keys, npcra(hourly[rows]), strict=True):
            out[k][d] = v
    if not with_timing:
        del out["m10_on"], out["l5_on"]
    return out


def hourly_hr_for_npcra(hr60: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    ok = np.isfinite(hr60).mean(axis=1) > HR_HOURLY_MIN_COVERAGE
    filled = np.where(np.isfinite(hr60), hr60, nanmean(hr60, axis=1)[:, None])
    return filled, ok


def periodogram(hr60: np.ndarray, steps60: np.ndarray, valid_day: np.ndarray, points: int = 1200) -> dict:
    """Lomb-Scargle on hourly HR and hourly steps; handles gaps without interpolation."""
    periods = np.logspace(np.log10(2.5), np.log10(24 * 16), points)
    ang = 2 * np.pi / periods
    t = np.arange(hr60.size, dtype=float)

    def power(series: np.ndarray) -> np.ndarray:
        m = np.isfinite(series)
        if m.sum() < 48:
            return np.full(points, np.nan)
        y = series[m] - series[m].mean()
        return signal.lombscargle(t[m], y, ang, normalize=True)

    st = steps60.astype(float).copy()
    st[~valid_day] = np.nan
    p_hr = power(hr60.ravel())
    p_st = power(st.ravel())
    band = (periods > 20) & (periods < 28)
    peak = float(periods[np.nanargmax(np.where(band, p_hr, 0))]) if np.isfinite(p_hr).any() else np.nan
    return {"periods": periods, "hr": p_hr, "steps": p_st, "dominant_hr_period": peak}
