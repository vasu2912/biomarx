from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class MetricGroup(StrEnum):
    ACTIVITY = "activity"
    SLEEP = "sleep"
    CIRCADIAN = "circadian"
    NOCTURNAL = "nocturnal"
    GAIT = "gait"


class Direction(StrEnum):
    """Which way is generally favourable, for colouring deltas."""

    HIGHER = "higher"
    LOWER = "lower"
    NEUTRAL = "neutral"


@dataclass(frozen=True)
class Metric:
    key: str
    label: str
    unit: str
    group: MetricGroup
    decimals: int
    direction: Direction
    description: str
    clock: bool = False
    correlate: bool = False


_M = Metric
_G = MetricGroup
_D = Direction

METRICS: tuple[Metric, ...] = (
    _M("steps", "Steps", "steps", _G.ACTIVITY, 0, _D.HIGHER, "Steps on day D, max across sources per 10-min bin.", correlate=True),
    _M("active_kcal", "Active energy", "kcal", _G.ACTIVITY, 0, _D.HIGHER, "Active energy burned on day D.", correlate=True),
    _M(
        "onset_h",
        "Sleep onset",
        "clock",
        _G.SLEEP,
        2,
        _D.NEUTRAL,
        "Start of the main sleep episode of night D, in hours after midnight.",
        clock=True,
        correlate=True,
    ),
    _M("mid_h", "Mid-sleep", "clock", _G.SLEEP, 2, _D.NEUTRAL, "Midpoint of the main sleep episode.", clock=True, correlate=True),
    _M("offset_h", "Wake time", "clock", _G.SLEEP, 2, _D.NEUTRAL, "End of the main sleep episode.", clock=True, correlate=True),
    _M("tst", "Total sleep", "h", _G.SLEEP, 2, _D.HIGHER, "Minutes staged Core, REM or Deep inside the main episode.", correlate=True),
    _M("tib", "Time in bed", "h", _G.SLEEP, 2, _D.NEUTRAL, "Length of the main sleep episode."),
    _M("eff", "Sleep efficiency", "%", _G.SLEEP, 1, _D.HIGHER, "Total sleep as a share of the main episode.", correlate=True),
    _M("deep_h", "Deep", "h", _G.SLEEP, 2, _D.HIGHER, "Deep sleep in the main episode."),
    _M("core_h", "Core", "h", _G.SLEEP, 2, _D.NEUTRAL, "Core (light) sleep in the main episode."),
    _M("rem_h", "REM", "h", _G.SLEEP, 2, _D.HIGHER, "REM sleep in the main episode."),
    _M("deep_pct", "Deep %", "%", _G.SLEEP, 1, _D.HIGHER, "Deep sleep as a share of total sleep.", correlate=True),
    _M("rem_pct", "REM %", "%", _G.SLEEP, 1, _D.HIGHER, "REM sleep as a share of total sleep.", correlate=True),
    _M("waso", "Awake in bed", "min", _G.SLEEP, 0, _D.LOWER, "Minutes staged Awake inside the main episode.", correlate=True),
    _M(
        "sri",
        "Sleep regularity",
        "index",
        _G.SLEEP,
        0,
        _D.HIGHER,
        "Sleep Regularity Index (Phillips 2017): minute sleep/wake agreement of day D and D+1.",
        correlate=True,
    ),
    _M("night_hr", "Sleeping HR", "bpm", _G.NOCTURNAL, 1, _D.LOWER, "Mean heart rate inside the main sleep episode.", correlate=True),
    _M("night_hr_min", "Sleeping HR floor", "bpm", _G.NOCTURNAL, 1, _D.LOWER, "5th percentile of heart rate during sleep."),
    _M("day_hr", "Daytime HR", "bpm", _G.NOCTURNAL, 1, _D.NEUTRAL, "Mean heart rate between 10:00 and 20:00 on day D."),
    _M("dip", "Nocturnal HR dip", "%", _G.NOCTURNAL, 1, _D.HIGHER, "Drop of sleeping HR below daytime HR. Under 10% is non-dipping.", correlate=True),
    _M("hrv", "Night HRV", "ms", _G.NOCTURNAL, 0, _D.HIGHER, "Mean SDNN of HRV samples taken during sleep.", correlate=True),
    _M("rhr_next", "Resting HR", "bpm", _G.NOCTURNAL, 0, _D.LOWER, "Resting heart rate reported the morning after night D.", correlate=True),
    _M("spo2", "Night SpO2", "%", _G.NOCTURNAL, 1, _D.HIGHER, "Mean blood-oxygen saturation during sleep.", correlate=True),
    _M("spo2_p5", "Night SpO2 floor", "%", _G.NOCTURNAL, 1, _D.HIGHER, "5th percentile of SpO2 during sleep."),
    _M("resp", "Night respiratory rate", "br/min", _G.NOCTURNAL, 1, _D.NEUTRAL, "Mean respiratory rate during sleep.", correlate=True),
    _M("hr_mesor", "HR MESOR", "bpm", _G.CIRCADIAN, 1, _D.NEUTRAL, "Rhythm-adjusted mean of a 24 h cosine fit to 3 days of 5-min HR.", correlate=True),
    _M("hr_amp", "HR rhythm amplitude", "bpm", _G.CIRCADIAN, 1, _D.HIGHER, "Half the peak-to-trough swing of the fitted 24 h HR cosine.", correlate=True),
    _M("hr_acro", "HR acrophase", "clock", _G.CIRCADIAN, 2, _D.NEUTRAL, "Clock time of the fitted HR peak.", clock=True),
    _M("hr_r2", "Cosinor R²", "", _G.CIRCADIAN, 2, _D.HIGHER, "Variance of HR explained by the 24 h cosine."),
    _M("is_steps", "Interdaily stability (steps)", "", _G.CIRCADIAN, 2, _D.HIGHER, "How alike days are in their hourly step profile, 0 to 1."),
    _M("iv_steps", "Intradaily variability (steps)", "", _G.CIRCADIAN, 2, _D.LOWER, "Hour-to-hour fragmentation of steps, 0 to 2."),
    _M("ra_steps", "Relative amplitude (steps)", "", _G.CIRCADIAN, 2, _D.HIGHER, "(M10 - L5) / (M10 + L5) of the hourly step profile."),
    _M("m10_on", "M10 onset", "clock", _G.CIRCADIAN, 0, _D.NEUTRAL, "Start hour of the most active 10 hours.", clock=True),
    _M("l5_on", "L5 onset", "clock", _G.CIRCADIAN, 0, _D.NEUTRAL, "Start hour of the least active 5 hours.", clock=True),
    _M("is_hr", "Interdaily stability (HR)", "", _G.CIRCADIAN, 2, _D.HIGHER, "Interdaily stability of hourly heart rate."),
    _M("iv_hr", "Intradaily variability (HR)", "", _G.CIRCADIAN, 2, _D.LOWER, "Intradaily variability of hourly heart rate."),
    _M("ra_hr", "Relative amplitude (HR)", "", _G.CIRCADIAN, 2, _D.HIGHER, "Relative amplitude of hourly heart rate."),
    _M("walking_speed", "Walking speed", "km/hr", _G.GAIT, 2, _D.HIGHER, "Daily median walking speed measured by iPhone."),
    _M("step_length", "Step length", "cm", _G.GAIT, 1, _D.HIGHER, "Daily median walking step length."),
    _M("double_support", "Double-support time", "%", _G.GAIT, 1, _D.LOWER, "Share of the gait cycle with both feet on the ground."),
    _M("asymmetry", "Walking asymmetry", "%", _G.GAIT, 1, _D.LOWER, "Share of steps with asymmetric timing between feet."),
    _M("wear", "Wear time", "%", _G.ACTIVITY, 0, _D.HIGHER, "Share of the day with a heart-rate sample within 15 minutes."),
)

BY_KEY: dict[str, Metric] = {m.key: m for m in METRICS}
DAILY_KEYS: tuple[str, ...] = tuple(m.key for m in METRICS)
CORRELATED: tuple[str, ...] = tuple(m.key for m in METRICS if m.correlate)

GAIT_TYPES: dict[str, str] = {
    "walking_speed": "WalkingSpeed",
    "step_length": "WalkingStepLength",
    "double_support": "WalkingDoubleSupportPercentage",
    "asymmetry": "WalkingAsymmetryPercentage",
}
