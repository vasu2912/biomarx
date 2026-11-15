"""Which source supplied each day of each record family, by the same best-source rules the pipeline uses."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

# count: the source with most samples that day; sum: most total value (steps); staged: most staged sleep minutes that night.
Rule = Literal["count", "sum", "staged"]


@dataclass(frozen=True)
class Family:
    key: str
    label: str
    record_type: str
    rule: Rule


FAMILIES: tuple[Family, ...] = (
    Family("hr", "Heart rate", "HeartRate", "count"),
    Family("sleep", "Sleep", "SleepAnalysis", "staged"),
    Family("steps", "Steps", "StepCount", "sum"),
    Family("hrv", "HRV", "HeartRateVariabilitySDNN", "count"),
    Family("spo2", "SpO2", "OxygenSaturation", "count"),
    Family("daylight", "Daylight", "TimeInDaylight", "count"),
)


def source_codes(best: dict[str, tuple[np.ndarray, np.ndarray]], nd: int) -> tuple[list[str], dict[str, np.ndarray]]:
    """Sources ordered by the days they supply (any family), most first, and per family the source index per day, −1 for none."""
    names = np.concatenate([n for _, n in best.values()]) if best else np.array([], dtype=object)
    days = np.concatenate([i for i, _ in best.values()]) if best else np.array([], dtype=np.int64)
    inside = (days >= 0) & (days < nd)
    covered: dict[str, set[int]] = {}
    for s, d in zip(names[inside].tolist(), days[inside].tolist(), strict=True):
        covered.setdefault(s, set()).add(d)
    order = sorted(covered, key=lambda s: (-len(covered[s]), s))
    index = {s: k for k, s in enumerate(order)}
    codes: dict[str, np.ndarray] = {}
    for key, (idx, src) in best.items():
        c = np.full(nd, -1, dtype=np.int16)
        keep = (idx >= 0) & (idx < nd)
        c[idx[keep]] = [index[s] for s in src[keep].tolist()]
        codes[key] = c
    return order, codes
