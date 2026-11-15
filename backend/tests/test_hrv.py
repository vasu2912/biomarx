import math

import numpy as np
import pytest

from biomarx.core.analysis.hrv import rmssd, trailing_mean
from biomarx.impl.apple_health import beat_seconds

NNBSP = "\u202f"  # the export separates the clock from AM/PM with a narrow no-break space


def _beats(rr_ms: list[int]) -> np.ndarray:
    return np.r_[0, np.cumsum(rr_ms)] / 1000


def test_rmssd_drops_artifact_rr_and_the_differences_around_it():
    # RR alternates 1000/1040 ms with one missed beat (a 2040 ms RR). Its two differences are dropped, leaving 22 of
    # 40 ms: RMSSD 40. Kept, they would give sqrt((22 × 40² + 1000² + 1040²) / 24) ≈ 297.
    assert rmssd(_beats([1000, 1040] * 6 + [2040] + [1000, 1040] * 6)) == pytest.approx(40)
    # Differences cycle 60, −80, 40, −20 over 23 differences: 5 full cycles plus 60, −80, 40.
    assert rmssd(_beats([800, 860, 780, 820] * 6)) == pytest.approx(math.sqrt((5 * 12000 + 11600) / 23))


def test_rmssd_needs_twenty_valid_differences():
    assert math.isnan(rmssd(_beats([900, 930] * 9 + [900])))  # 19 RR, 18 differences
    assert rmssd(_beats([900, 930] * 10 + [900])) == pytest.approx(30)  # 21 RR, 20 differences
    assert math.isnan(rmssd(_beats([250] * 40)))  # every RR under 300 ms
    assert math.isnan(rmssd(np.zeros(0)))


def test_beat_times_roll_over_midnight_and_read_twelve_hour_clocks():
    times = [f"11:59:51.00{NNBSP}PM", f"11:59:59.50{NNBSP}PM", f"12:00:00.30{NNBSP}AM", f"12:00:01.10{NNBSP}AM"]
    assert beat_seconds("2026-03-05 23:59:50", times) == pytest.approx([1.0, 9.5, 10.3, 11.1])
    assert beat_seconds("2026-03-05 11:59:58", ["11:59:59.00 AM", "12:00:00.25 PM", "1:00:00.00 PM"]) == pytest.approx([1.0, 2.25, 3602.0])


def test_trailing_mean_needs_three_of_the_last_seven_nights():
    m = trailing_mean(np.array([1.0, np.nan, 3.0, np.nan, 5.0, np.nan, np.nan, np.nan]))
    assert np.isnan(m[:4]).all()
    assert m[4] == pytest.approx(3.0) and m[6] == pytest.approx(3.0)
    assert np.isnan(m[7])  # night 0 has left the window; two nights are too few
