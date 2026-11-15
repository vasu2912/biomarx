"""Beat-to-beat heart-rate variability from the beat times Apple keeps inside each HRV reading.

RMSSD as defined by the Task Force of the ESC and NASPE. Heart rate variability: standards of measurement, physiological
interpretation and clinical use. Circulation 1996;93:1043–1065. The 7-night rolling mean of ln RMSSD follows Plews DJ et al.
Training adaptation and heart rate variability in elite endurance athletes: opening the door to effective monitoring.
Sports Med 2013;43:773–781.
"""

from __future__ import annotations

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

MIN_RR_MS = 300.0
MAX_RR_MS = 2000.0
MIN_DIFFS = 20
ROLLING_NIGHTS = 7
MIN_ROLLING_NIGHTS = 3


def rmssd(beats_s: np.ndarray) -> float:
    """RMSSD in ms of one list of beat times in seconds, or NaN with fewer than MIN_DIFFS valid successive differences.

    An RR outside MIN_RR_MS..MAX_RR_MS is dropped, and so is every successive difference it takes part in.
    """
    rr = np.diff(np.asarray(beats_s, dtype=np.float64)) * 1000.0
    ok = (rr >= MIN_RR_MS) & (rr <= MAX_RR_MS)
    d = np.diff(rr)[ok[1:] & ok[:-1]]
    return float(np.sqrt(np.mean(d * d))) if d.size >= MIN_DIFFS else float("nan")


def trailing_mean(x: np.ndarray, window: int = ROLLING_NIGHTS, min_n: int = MIN_ROLLING_NIGHTS) -> np.ndarray:
    """Per day, the mean of the `window` days ending on it, where at least `min_n` of them have a value."""
    x = np.asarray(x, dtype=float)
    win = sliding_window_view(np.r_[np.full(window - 1, np.nan), x], window)
    n = np.isfinite(win).sum(axis=1)
    with np.errstate(invalid="ignore"):
        s = np.nansum(win, axis=1) / n
    return np.where(n >= min_n, s, np.nan)
