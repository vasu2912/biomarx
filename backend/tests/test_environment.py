import datetime as dt

import numpy as np
import pytest

from biomarx.core.analysis import environment as env
from biomarx.core.analysis.fitness import Weeks

MONDAY = dt.date(2026, 3, 2)
D = 1440


def test_dose_of_four_hours_at_83_db():
    # H.870: 4 h × 10^((83 − 80)/10) / 40 × 100 = 10 × 10^0.3 = 19.9526…%
    assert env.dose_percent(np.array([4.0]), np.array([83.0]))[0] == pytest.approx(10 * 10**0.3)
    assert env.dose_percent(np.array([4.0]), np.array([83.0]))[0] == pytest.approx(19.9526, abs=1e-4)
    # The allowance itself: 40 h at 80 dB is 100%, and 3 dB more halves the hours.
    assert env.dose_percent(np.array([40.0, 20.0]), np.array([80.0, 83.0])).tolist() == pytest.approx([100, 99.763], abs=1e-3)


def test_weekly_dose_sums_samples_by_their_start_week():
    weeks = Weeks.covering(MONDAY, 0, 14, 14)
    start = np.array([60, 2 * D + 60, 7 * D + 23 * 60 + 50, 13 * D])
    dur = np.array([120.0, 120.0, 30.0, 0.0])
    level = np.array([83.0, 83.0, 90.0, 100.0])
    dose, n = env.weekly_dose(start, dur, level, weeks, 14)
    assert dose[0] == pytest.approx(10 * 10**0.3)  # two 2 h samples at 83 dB
    assert dose[1] == pytest.approx(0.5 * 10 / 40 * 100)  # 30 min at 90 dB = 12.5%; the zero-length sample counts nothing
    assert n.tolist() == [2, 1]


def test_season_takes_the_median_across_years_of_weekly_medians():
    origin = dt.date(2024, 1, 1)  # a Monday, ISO week 1 of 2024
    nd = 3 * 371
    iso_year, iso_week = env.iso_weeks(origin, nd)
    values = np.full(nd, np.nan)
    for year, level in ((2024, 10.0), (2025, 20.0), (2026, 60.0)):
        days = np.flatnonzero((iso_year == year) & (iso_week == 2))
        values[days[:3]] = [level - 1, level, level + 5]  # weekly median = level
    w3 = np.flatnonzero((iso_year == 2025) & (iso_week == 3))
    values[w3[:1]] = 5.0  # one day is that week's median
    s = env.season(values, iso_year, iso_week)
    assert s.years[1] == 3 and s.median[1] == 20
    assert s.q25[1] == pytest.approx(15) and s.q75[1] == pytest.approx(40)
    assert s.years[0] == 0 and np.isnan(s.median[0])
    assert s.years[2] == 1 and s.median[2] == 5 and np.isnan(s.q25[2])
