import warnings

import numpy as np


def nanmean(a: np.ndarray, axis: int | None = None) -> np.ndarray:
    """nanmean that stays silent on all-NaN slices, which are expected on unworn days."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        return np.nanmean(a, axis=axis)


def nanmedian(a: np.ndarray, axis: int | None = None):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        return np.nanmedian(a, axis=axis)


def finite_or_none(x) -> float | None:
    x = float(x)
    return x if np.isfinite(x) else None
