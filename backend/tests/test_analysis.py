import numpy as np
import pytest

from biomarx.core.analysis import circadian, patterns
from biomarx.core.analysis.grids import SleepSegments, paint_sleep
from biomarx.core.domain import ImportJob, ImportState, SleepCode


def test_cosinor_recovers_a_known_rhythm():
    t = np.arange(10 * 288) * 5 / 60
    hr = 70 + 12 * np.cos(2 * np.pi * (t - 16) / 24)
    out = circadian.cosinor(hr.reshape(10, 288))
    assert out["hr_mesor"][5] == pytest.approx(70, abs=1e-6)
    assert out["hr_amp"][5] == pytest.approx(12, abs=1e-6)
    assert out["hr_acro"][5] == pytest.approx(16, abs=1e-6)
    assert out["hr_r2"][5] == pytest.approx(1)


def test_cosinor_skips_days_with_too_little_data():
    hr = np.full((5, 288), np.nan)
    hr[:, :20] = 60
    assert np.isnan(circadian.cosinor(hr)["hr_mesor"]).all()


def test_npcra_identical_days_are_perfectly_stable():
    day = np.r_[np.zeros(8), np.full(16, 100.0)]
    is_, _, ra, m10, l5 = circadian.npcra(np.tile(day, (14, 1)))
    assert is_ == pytest.approx(1)
    assert ra == pytest.approx(1)
    assert (m10, l5) == (8, 0)


def test_periodogram_finds_the_daily_period():
    hours = np.arange(60 * 24)
    hr60 = (60 + 10 * np.sin(2 * np.pi * hours / 24)).reshape(60, 24)
    steps = np.random.default_rng(0).poisson(50, size=(60, 24))
    out = circadian.periodogram(hr60, steps, np.ones(60, bool))
    assert out["dominant_hr_period"] == pytest.approx(24, abs=0.2)


def test_awake_overrides_earlier_stages():
    seg = SleepSegments(
        night=np.array([0, 0]),
        stage=np.array([SleepCode.CORE, SleepCode.AWAKE], dtype=np.int8),
        start=np.array([10, 15]),
        end=np.array([30, 20]),
    )
    out = paint_sleep(100, seg)
    assert (out[10:15] == SleepCode.CORE).all()
    assert (out[15:21] == SleepCode.AWAKE).all()
    assert out[25] == SleepCode.CORE


def test_rolling_mean_matches_a_naive_centered_window():
    rng = np.random.default_rng(1)
    x = rng.normal(size=50)
    x[rng.choice(50, 12, replace=False)] = np.nan
    got = patterns.rolling_mean(x, 7, 3)
    for i in range(50):
        win = x[max(0, i - 3) : i + 4]
        win = win[np.isfinite(win)]
        assert np.isnan(got[i]) == (win.size < 3)
        if win.size >= 3:
            assert got[i] == pytest.approx(win.mean())


def test_correlation_orders_related_metrics_together():
    rng = np.random.default_rng(2)
    a = rng.normal(size=200)
    daily = {"a": a, "b": rng.normal(size=200), "c": a * 2 + rng.normal(scale=0.1, size=200)}
    out = patterns.correlation(daily, ["a", "b", "c"])
    pos = {m: i for i, m in enumerate(out["metrics"])}
    assert abs(pos["a"] - pos["c"]) == 1
    assert out["rho"][pos["a"]][pos["c"]] > 0.9


def test_import_job_rejects_illegal_transitions():
    job = ImportJob(id="x", filename="export.zip", size=1)
    with pytest.raises(ValueError):
        job.advance(ImportState.READY)
    job.advance(ImportState.QUEUED)
    job.fail("boom")
    assert job.state == ImportState.FAILED and not job.active
