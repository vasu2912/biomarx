"""Cross-metric structure: what moves together, and when many systems shifted at once."""

from __future__ import annotations

import numpy as np
from scipy import stats
from scipy.cluster import hierarchy
from scipy.spatial.distance import squareform

from biomarx.core.analysis._np import nanmedian

MAD_TO_SD = 1.4826


def usable_metrics(daily: dict[str, np.ndarray], keys: tuple[str, ...], days: int) -> list[str]:
    need = max(10, min(60, int(days * 0.3)))
    return [k for k in keys if np.isfinite(daily[k]).sum() > need]


def correlation(daily: dict[str, np.ndarray], keys: list[str]) -> dict:
    """Pairwise Spearman rho with Benjamini-Hochberg q, ordered by average-linkage clustering on 1-|rho|."""
    k = len(keys)
    rho, pv, n = np.eye(k), np.zeros((k, k)), np.zeros((k, k), dtype=int)
    for i in range(k):
        n[i, i] = int(np.isfinite(daily[keys[i]]).sum())
        for j in range(i + 1, k):
            a, b = daily[keys[i]], daily[keys[j]]
            m = np.isfinite(a) & np.isfinite(b)
            n[i, j] = n[j, i] = int(m.sum())
            if m.sum() < 3 or np.ptp(a[m]) == 0 or np.ptp(b[m]) == 0:
                rho[i, j] = rho[j, i] = np.nan
                pv[i, j] = pv[j, i] = 1.0
                continue
            r, p = stats.spearmanr(a[m], b[m])
            rho[i, j] = rho[j, i] = r
            pv[i, j] = pv[j, i] = p
    iu = np.triu_indices(k, 1)
    q = np.ones((k, k))
    if iu[0].size:
        q[iu] = stats.false_discovery_control(pv[iu])
        q[(iu[1], iu[0])] = q[iu]
    order = np.arange(k)
    if k > 2:
        dist = 1 - np.abs(np.nan_to_num(rho, nan=0.0))
        np.fill_diagonal(dist, 0)
        order = hierarchy.leaves_list(hierarchy.linkage(squareform(dist, checks=False), "average"))
    ix = np.ix_(order, order)
    return {"metrics": [keys[i] for i in order], "rho": rho[ix], "q": q[ix], "n": n[ix]}


def robust_state(daily: dict[str, np.ndarray], keys: list[str]) -> np.ndarray:
    """7-day centred rolling mean, standardised by median and MAD, clipped to +-3. Shape metrics x days."""
    rows = []
    for key in keys:
        smooth = rolling_mean(daily[key], 7, 3)
        med = nanmedian(smooth)
        mad = nanmedian(np.abs(smooth - med)) * MAD_TO_SD
        z = (smooth - med) / mad if mad and np.isfinite(mad) else np.full_like(smooth, np.nan)
        rows.append(np.clip(z, -3, 3))
    return np.array(rows).reshape(len(keys), -1)


def rolling_mean(x: np.ndarray, window: int, min_periods: int) -> np.ndarray:
    """Centred rolling mean matching pandas `rolling(window, center=True, min_periods)`."""
    finite = np.isfinite(x)
    vals = np.where(finite, x, 0.0)
    left = (window - 1) // 2 + (window - 1) % 2
    pad = lambda a: np.concatenate((np.zeros(left), a, np.zeros(window - 1 - left)))  # noqa: E731
    csum = np.concatenate(([0.0], np.cumsum(pad(vals))))
    ccnt = np.concatenate(([0.0], np.cumsum(pad(finite.astype(float)))))
    s = csum[window:] - csum[:-window]
    c = ccnt[window:] - ccnt[:-window]
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(c >= min_periods, s / c, np.nan)[: x.size]
