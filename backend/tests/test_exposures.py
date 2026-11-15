import numpy as np
import pytest
from scipy import stats

from biomarx.core.analysis import exposures as ex
from biomarx.core.analysis.sleep import Nights

D = 1440


def nights(onsets: list[tuple[int, int]], length: int = 480) -> Nights:
    """Nights from (day, onset minute after midnight of that day) pairs, each `length` minutes long."""
    night = np.array([d for d, _ in onsets])
    i0 = np.array([d * D + m for d, m in onsets])
    return Nights(night, i0, i0 + length, {})


def test_workouts_are_grouped_by_the_gap_to_sleep_onset():
    n = nights([(1, 23 * 60), (2, 23 * 60), (3, 23 * 60), (4, 23 * 60), (5, 23 * 60), (6, 24 * 60 + 60), (7, 23 * 60)])
    ends = np.array(
        [
            2 * D + 18 * 60,  # night 2: 5 h before onset
            3 * D + 10 * 60,  # night 3: an earlier workout, superseded by the next
            3 * D + 21 * 60 + 30,  # night 3: 1.5 h before
            4 * D + 22 * 60 + 30,  # night 4: 30 min before
            5 * D + 23 * 60 + 30,  # night 5: ends after onset, so the night gets nothing
            7 * D + 30,  # night 6 falls asleep at 01:00 on day 7: 30 min before; not night 7's
        ]
    )
    got = ex.timing_groups(n, ends, np.ones(ends.size, bool))
    assert got[:4].tolist() == [0, 1, 2, 3] and np.isnan(got[4])
    assert got[5:].tolist() == [3, 0]


def test_one_and_three_hours_both_fall_in_the_middle_group_and_uncounted_workouts_drop_the_night():
    n = nights([(1, 23 * 60), (2, 23 * 60)])
    ends = np.array([D + 20 * 60, 2 * D + 22 * 60])  # exactly 3 h and exactly 1 h before onset
    assert ex.timing_groups(n, ends, np.array([True, True])).tolist() == [2, 2]
    got = ex.timing_groups(n, ends, np.array([True, False]))
    assert got[0] == 2 and np.isnan(got[1])  # night 2 had a workout, just not a counted one: not a rest night


def test_hard_is_at_or_above_the_median_trimp():
    assert ex.hard(np.array([10.0, 20.0, 30.0, np.nan])).tolist() == [False, True, True, False]
    with pytest.raises(ex.Unavailable):
        ex.hard(np.array([np.nan]))


def test_overlap_sum_prorates_samples_across_the_window():
    start, dur, val = np.array([0, 8, 20]), np.array([5.0, 5.0, 5.0]), np.array([5.0, 2.0, 4.0])
    # [0, 5) has 2 of its 5 minutes inside [3, 10): 5 × 2/5 = 2. [8, 13) has 2 of 5: 2 × 2/5 = 0.8. [20, 25) is outside.
    assert ex.overlap_sum(start, dur, val, np.array([3]), np.array([10]))[0] == pytest.approx(2.8)


def test_morning_daylight_counts_the_two_hours_after_waking_while_worn():
    n = nights([(1, 23 * 60), (2, 23 * 60), (3, 23 * 60)])  # night 1 ends 07:00 on day 2, night 2 ends 07:00 on day 3
    wake2, wake3 = 2 * D + 7 * 60, 3 * D + 7 * 60
    measured = np.zeros(5 * D, bool)
    measured[wake2 : wake2 + 120] = True
    measured[wake3 : wake3 + 59] = True  # worn under half of night 3's morning
    light = ex.Daylight(np.array([wake2 + 30, wake2 + 118, wake3]), np.full(3, 5.0), np.array([5.0, 5.0, 5.0]), measured)
    got = ex.morning_daylight(n, light)
    assert np.isnan(got[0])  # no night 0, so no known wake time
    assert got[1] == pytest.approx(5 + 5 * 2 / 5)
    assert np.isnan(got[2])


def test_daily_daylight_is_missing_on_days_the_logging_device_was_off():
    measured = np.zeros(3 * D, bool)
    measured[:D] = True
    light = ex.Daylight(np.array([600, D + 600]), np.full(2, 5.0), np.array([3.0, 4.0]), measured)
    got = ex.daily_daylight(light, 2, 0.6)
    assert got[0] == 3 and np.isnan(got[1])


def test_bootstrap_ci_contains_the_true_median_difference():
    ref = np.arange(1.0, 22.0)
    other = ref + 3  # medians 11 and 14
    cell = ex.compare(ref, other)
    assert cell.diff == 3 and cell.median == 14 and cell.n == 21
    assert cell.ci_lo <= 3 <= cell.ci_hi
    assert cell.p == pytest.approx(stats.mannwhitneyu(other, ref, alternative="two-sided").pvalue)
    again = ex.compare(ref, other)  # fixed seed
    assert (again.ci_lo, again.ci_hi) == (cell.ci_lo, cell.ci_hi)


def test_benjamini_hochberg_by_hand():
    # Sorted 0.01, 0.03, 0.04 → 0.03, 0.045, 0.04 → monotone from the top: 0.03, 0.04, 0.04.
    assert ex._fdr(np.array([0.01, 0.04, 0.03, np.nan])).tolist()[:3] == pytest.approx([0.03, 0.04, 0.04])


def test_groups_share_one_fdr_and_gate_on_five_nights():
    rng = np.random.default_rng(0)
    codes = np.r_[np.zeros(20), np.ones(20), np.full(4, 2)]
    ys = {"a": np.r_[rng.normal(0, 1, 20), rng.normal(2, 1, 20), rng.normal(0, 1, 4)], "b": rng.normal(0, 1, 44)}
    got = ex.assess_groups(codes, ys, 3)
    ref, one, few = got["a"]
    assert ref.n == 20 and np.isnan(ref.diff) and np.isnan(ref.q)
    assert few.n == 4 and np.isfinite(few.median) and np.isnan(few.diff) and np.isnan(few.p)
    ps = np.array([one.p, got["b"][1].p])
    assert [one.q, got["b"][1].q] == pytest.approx(stats.false_discovery_control(ps).tolist())
    assert one.q < 0.05


def test_spearman_needs_ten_paired_nights():
    x = np.arange(12.0)
    got = ex.assess_continuous(x, {"up": x * 2, "short": np.r_[np.full(3, np.nan), x[3:]]})
    assert got["up"].rho == pytest.approx(1) and got["up"].n == 12
    assert got["short"].n == 9 and np.isnan(got["short"].rho)
    assert got["up"].q == pytest.approx(got["up"].p)  # the only tested outcome
