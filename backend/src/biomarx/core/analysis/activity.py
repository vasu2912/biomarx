from __future__ import annotations

import numpy as np
from scipy import stats

from biomarx.core.analysis._np import nanmean
from biomarx.core.analysis.grids import Grids

STEP_EDGES = np.r_[0, 1, 50, 100, 200, 300, 400, 500, 650, 800, 1000, 1400]
KDE_GRID = np.linspace(35, 150, 116)
KDE_SAMPLE = 15000


def hr_vs_steps(grids: Grids, lo: int, hi: int, x_bins: int = 56, y_bins: int = 48) -> dict:
    """Dose-response of 10-min mean HR against steps in the same 10-min bin."""
    hr10 = nanmean(grids.hr1_days[lo:hi].reshape(hi - lo, 144, 10), axis=2).ravel()
    s10 = grids.steps10[lo:hi].ravel()
    m = np.isfinite(hr10)
    counts, xe, ye = np.histogram2d(s10[m], hr10[m], bins=(x_bins, y_bins), range=((0, 1400), (40, 160)))
    mid, med = [], []
    for a, b in zip(STEP_EDGES[:-1], STEP_EDGES[1:], strict=True):
        sel = m & (s10 >= a) & (s10 < b)
        if sel.sum() > 30:
            mid.append((a + b) / 2)
            med.append(float(np.median(hr10[sel])))
    return {"x_edges": xe, "y_edges": ye, "counts": counts.T, "median_x": mid, "median_hr": med, "bins": int(m.sum())}


def monthly_ridgeline(grids: Grids, lo: int, hi: int, months: list[tuple[str, int, int]]) -> dict:
    """Gaussian KDE of 1-min HR per calendar month, split by asleep vs awake.

    `months` lists (label, first day index, end day index) inside [lo, hi).
    """
    rng = np.random.default_rng(0)
    out = []
    for label, a, b in months:
        a, b = max(a, lo), min(b, hi)
        hr = grids.hr1[a * 1440 : b * 1440]
        asleep = grids.asleep[a * 1440 : b * 1440]
        row = {"month": label}
        for key, mask in (("awake", ~asleep), ("asleep", asleep)):
            v = hr[mask & np.isfinite(hr)]
            if v.size < 200:
                row[key] = None
                continue
            v = rng.choice(v, min(v.size, KDE_SAMPLE), replace=False)
            dens = stats.gaussian_kde(v, bw_method=0.15)(KDE_GRID)
            row[key] = dens / dens.max()
        out.append(row)
    return {"hr": KDE_GRID, "months": out}
