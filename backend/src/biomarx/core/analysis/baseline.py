"""Each night against the person's own recent nights: a trailing robust baseline and the deviation from it.

Leys C et al. Detecting outliers: do not use standard deviation around the mean, use absolute deviation around the median.
J Exp Soc Psychol 2013;49:764–766. No score is formed: signals are only counted side by side.
"""

from __future__ import annotations

from typing import Literal

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from biomarx.core.analysis._np import nanmedian
from biomarx.core.analysis.patterns import MAD_TO_SD
from biomarx.core.analysis.sleep import Nights

Concern = Literal["up", "down"]

BASELINE_NIGHTS = 28
MIN_BASELINE_NIGHTS = 14
FLAG_Z = 2.0
MIN_CONCURRENT = 2

# Night signals and the direction that departs from health. Radin 2020 and Mishra 2020 report resting HR and related
# signals shifting from the personal baseline ahead of infection.
SIGNALS: dict[str, Concern] = {"rhr_next": "up", "hrv": "down", "resp": "up", "night_hr": "up", "spo2": "down"}
WRIST_TEMP: tuple[str, Concern] = ("wrist_temp", "up")


def trailing_robust_z(x: np.ndarray, window: int = BASELINE_NIGHTS, min_n: int = MIN_BASELINE_NIGHTS) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per night: median of the `window` nights before it, 1.4826 × their MAD, and the robust z of the night's value.

    The current night is never in its own baseline. Fewer than `min_n` valid nights, or a zero MAD, gives no z.
    """
    x = np.asarray(x, dtype=float)
    n = x.size
    med, scale = np.full(n, np.nan), np.full(n, np.nan)
    if n == 0:
        return med, scale, med.copy()
    win = sliding_window_view(np.r_[np.full(window, np.nan), x], window)[:n]  # row i is x[i - window : i]
    ok = np.isfinite(win).sum(axis=1) >= min_n
    if ok.any():
        w = win[ok]
        m = nanmedian(w, axis=1)
        med[ok] = m
        scale[ok] = nanmedian(np.abs(w - m[:, None]), axis=1) * MAD_TO_SD
    with np.errstate(invalid="ignore", divide="ignore"):
        z = np.where(scale > 0, (x - med) / scale, np.nan)
    return med, scale, z


def concerning(z: np.ndarray, concern: Concern) -> np.ndarray:
    """True where z is at least FLAG_Z in the signal's concerning direction."""
    signed = z if concern == "up" else -z
    return np.nan_to_num(signed, nan=-np.inf) >= FLAG_Z


def concurrent(zs: dict[str, np.ndarray], concerns: dict[str, Concern]) -> np.ndarray:
    """How many signals were off their baseline in their concerning direction, per night."""
    flags = [concerning(z, concerns[k]) for k, z in zs.items()]
    return np.sum(flags, axis=0).astype(int) if flags else np.zeros(0, int)


def per_day(nights: Nights, values: np.ndarray, nd: int) -> np.ndarray:
    """A nights column laid out on the day index of night D; days without a main episode stay missing."""
    out = np.full(nd, np.nan)
    keep = (nights.night >= 0) & (nights.night < nd)
    out[nights.night[keep]] = values[keep]
    return out


def night_mean(nights: Nights, minutes: np.ndarray, values: np.ndarray, nd: int) -> np.ndarray:
    """Mean of the samples whose minute falls inside each main episode, by day of night D. One sample is enough."""
    out = np.full(nd, np.nan)
    if minutes.size == 0:
        return out
    order = np.argsort(minutes, kind="stable")
    m, v = minutes[order], values[order]
    lo = np.searchsorted(m, nights.i0, side="left")
    hi = np.searchsorted(m, nights.i1, side="left")
    for night, a, b in zip(nights.night, lo, hi, strict=True):
        if b > a and 0 <= night < nd:
            out[night] = float(np.mean(v[a:b]))
    return out
