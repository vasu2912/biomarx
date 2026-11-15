import numpy as np
import pytest

from biomarx.core.analysis import baseline, sleep


def test_robust_z_against_the_previous_nights_by_hand():
    # Baseline nights 1..14: median 7.5, absolute deviations 0.5, 0.5, 1.5, 1.5 … 6.5, 6.5 with median 3.5.
    x = np.r_[np.arange(1.0, 15.0), 20.0]
    med, scale, z = baseline.trailing_robust_z(x)
    assert med[14] == 7.5
    assert scale[14] == pytest.approx(3.5 * 1.4826)
    assert z[14] == pytest.approx(12.5 / 5.1891, abs=1e-4)  # 2.4089


def test_fewer_than_fourteen_valid_nights_gives_no_z():
    x = np.r_[np.arange(1.0, 14.0), np.nan, 20.0]  # 13 valid nights before the last one
    _, _, z = baseline.trailing_robust_z(x)
    assert np.isnan(z).all()
    _, _, z = baseline.trailing_robust_z(np.arange(1.0, 16.0))
    assert np.isnan(z[13]) and np.isfinite(z[14])


def test_the_current_night_is_not_in_its_own_baseline():
    x = np.r_[np.arange(1.0, 15.0), 20.0]
    y = x.copy()
    y[14] = 1000.0
    a, b = baseline.trailing_robust_z(x), baseline.trailing_robust_z(y)
    assert a[0][14] == b[0][14] and a[1][14] == b[1][14]


def test_the_window_holds_only_the_last_28_nights():
    x = np.r_[np.full(10, 500.0), np.arange(1.0, 29.0), 20.0]
    med, _, _ = baseline.trailing_robust_z(x)
    assert med[-1] == 14.5


def test_a_flat_baseline_gives_no_z():
    _, _, z = baseline.trailing_robust_z(np.r_[np.full(20, 60.0), 70.0])
    assert np.isnan(z[-1])


def test_concurrent_counts_only_the_concerning_direction():
    zs = {"rhr_next": np.array([2.5, -3.0, 1.9, np.nan]), "hrv": np.array([-2.0, -2.5, 2.5, -4.0])}
    got = baseline.concurrent(zs, {"rhr_next": "up", "hrv": "down"})
    assert got.tolist() == [2, 1, 0, 1]


def test_night_mean_takes_a_single_sample():
    n = sleep.Nights(np.array([0, 2]), np.array([100, 3000]), np.array([500, 3400]), {})
    got = baseline.night_mean(n, np.array([300.0, 3100.0, 3200.0, 4000.0]), np.array([34.0, 35.0, 36.0, 99.0]), 3)
    assert got[0] == 34 and np.isnan(got[1]) and got[2] == 35.5


def test_shortfall_sums_hours_short_of_seven_over_the_window():
    tst = np.array([6.0, 8.0, 5.0, 7.5, 6.5])
    # Short by 1, 0, 2, 0, 0.5: three-night sums 3, 2, 2.5.
    got = sleep.shortfall(tst, nights=3)
    assert np.isnan(got[:2]).all()
    assert got[2:].tolist() == [3.0, 2.0, 2.5]
    assert np.isnan(sleep.shortfall(tst)).all()  # fewer than 14 recorded nights


def test_floor_share_per_bin():
    night = np.array([0, 1, 3, 7, 8])
    tst = np.array([7.0, 6.9, 8.0, 5.0, 7.2])
    n, share = sleep.floor_share(np.array([0, 7, 14]), np.array([7, 14, 21]), night, tst)
    assert n.tolist() == [3, 2, 0]
    assert share[0] == pytest.approx(200 / 3) and share[1] == 50 and np.isnan(share[2])
