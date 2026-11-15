import datetime as dt
import math

import numpy as np
import pytest

from biomarx.core.analysis import fitness
from biomarx.core.analysis.fitness import Weeks, Workouts

MONDAY = dt.date(2026, 3, 2)


def test_trimp_of_a_steady_half_reserve_session():
    # Morton 1990: 30 min × 0.5 × 0.64·e^(1.92·0.5) for a man, 0.86·e^(1.67·0.5) for a woman.
    minutes = np.full(30, 0.5)
    assert fitness.trimp_per_minute(minutes, "male").sum() == pytest.approx(30 * 0.5 * 0.64 * math.exp(0.96))
    assert fitness.trimp_per_minute(minutes, "male").sum() == pytest.approx(25.0723, abs=1e-3)  # 9.6 × e^0.96 = 9.6 × 2.6117
    assert fitness.trimp_per_minute(minutes, "female").sum() == pytest.approx(30 * 0.5 * 0.86 * math.exp(0.835))


def test_trimp_clips_reserve_to_zero_and_one():
    got = fitness.trimp_per_minute(np.array([-0.2, 1.4, np.nan]), "male")
    assert got[0] == 0
    assert got[1] == pytest.approx(0.64 * math.exp(1.92))
    assert np.isnan(got[2])


def test_tanaka_and_karvonen():
    assert fitness.hr_max(40) == pytest.approx(180)
    assert fitness.hrr_fraction(np.array([130.0]), 60, 200)[0] == pytest.approx(0.5)


def test_effort_minutes_split_by_met_band():
    start = np.array([0, 60, 120, 1500])
    dur = np.array([10.0, 10.0, 5.0, 7.5])
    mets = np.array([2.0, 4.0, 7.0, 6.0])
    mod, vig, n = fitness.effort_minutes(start, dur, mets, 2)
    assert mod.tolist() == [10, 0]
    assert vig.tolist() == [5, 7.5]
    assert n.tolist() == [3, 1]


def test_missing_resting_hr_uses_the_trailing_median():
    rhr = np.array([60, 62, 70, np.nan, np.nan])
    got = fitness.rest_hr_filled(rhr)
    assert got[3] == 62 and got[4] == 62
    assert np.isnan(fitness.rest_hr_filled(np.array([np.nan, 60.0])))[0]


def test_hr_intensity_bands_count_ninety_percent_as_vigorous():
    # HRrest 60 and HRmax 180: 108 is 40%, 131 is 59%, 132 is 60%, 170 is 92%, 100 is 33%.
    day = np.full((1, 1440), np.nan)
    day[0, :6] = [108, 131, 132, 170, 100, np.nan]
    mod, vig, n = fitness.hr_intensity_minutes(day, np.array([60.0]), 180)
    assert (mod[0], vig[0], n[0]) == (2, 2, 5)


def test_weeks_start_on_monday_and_clip_to_the_timeline():
    origin = MONDAY + dt.timedelta(days=2)  # a Wednesday
    w = Weeks.covering(origin, 0, 10, 10)
    assert w.monday == [MONDAY, MONDAY + dt.timedelta(days=7)]
    assert w.lo.tolist() == [0, 5] and w.hi.tolist() == [5, 10]
    assert w.of_days(np.array([0, 4, 5, 9, 10])).tolist() == [0, 0, 1, 1, -1]


def _week_fixture(workouts: Workouts, nd: int = 14):
    hr1 = np.full((nd + 1) * 1440, np.nan, dtype=np.float32)
    hr1[600:630] = 120  # day 0, 10:00, HRR (120 − 60)/(180 − 60) = 0.5
    worn = np.isfinite(hr1)
    rest = np.full(nd, 60.0)
    samples = np.zeros(nd)
    samples[:7] = 1  # effort samples only in week one
    mod = np.where(samples > 0, 30.0, 0)
    weeks = Weeks.covering(MONDAY, 0, nd, nd)
    return weeks, hr1, worn, rest, (mod, np.zeros(nd), samples)


def test_weekly_trimp_strength_and_missing_effort():
    w = Workouts(
        np.array(["Running", "Running", "TraditionalStrengthTraining", "CoreTraining", "CoreTraining"], dtype=object),
        np.array([600, 600, 1440 * 8, 1440 * 8 + 120, 1440 * 10]),
        np.array([630, 630, 1440 * 8 + 60, 1440 * 8 + 150, 1440 * 10 + 20]),
    )
    out = fitness.weekly(*_week_fixture(w), w, age=40, sex="male")
    expected = 30 * 0.5 * 0.64 * math.exp(0.96)
    assert out["hrmax"] == pytest.approx(180)
    assert out["trimp"][0] == pytest.approx(expected), "a session logged twice counts once in the week"
    assert out["workout_trimp"][0] == pytest.approx(expected)
    assert out["trimp"][1] == 0
    assert out["strength_days"].tolist() == [0, 2]
    assert out["moderate"][0] == 210 and np.isnan(out["moderate"][1])
    assert (out["hrr_moderate"][0], out["hrr_vigorous"][0]) == (30, 0), "HRR 0.5 is moderate"


def test_weekly_without_a_profile_leaves_heart_rate_figures_empty():
    w = Workouts(np.array([], dtype=object), np.array([], dtype=int), np.array([], dtype=int))
    out = fitness.weekly(*_week_fixture(w), w, age=None, sex=None)
    assert np.isnan(out["trimp"]).all() and np.isnan(out["hrr_moderate"]).all()
    assert out["hrmax"] is None
    assert out["moderate"][0] == 210


def test_step_band_follows_age():
    assert fitness.step_bands(65) == [("60 and over", 6000, 8000)]
    assert fitness.step_bands(59) == [("Under 60", 8000, 10000)]
    assert len(fitness.step_bands(None)) == 2
