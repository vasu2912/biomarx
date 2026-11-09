from __future__ import annotations

import numpy as np
from scipy import signal


def analyse_ecg(microvolts: np.ndarray, fs: float) -> dict:
    """Band-pass 0.5-40 Hz, R-peak detection, RR intervals, Poincare and an ensemble beat."""
    y = microvolts.astype(np.float64) / 1000
    b, a = signal.butter(2, [0.5, 40], btype="band", fs=fs)
    yf = signal.filtfilt(b, a, y)
    peaks, _ = signal.find_peaks(yf, distance=int(0.33 * fs), prominence=np.percentile(yf, 99) * 0.45)
    rri = np.diff(peaks) / fs * 1000
    pre, post = int(0.25 * fs), int(0.45 * fs)
    beats = np.array([yf[p - pre : p + post] for p in peaks if p >= pre and p + post < yf.size])
    sd1 = float(np.std(np.diff(rri)) / np.sqrt(2)) if rri.size > 2 else np.nan
    sd2 = float(np.sqrt(max(2 * np.std(rri) ** 2 - sd1**2, 0))) if rri.size > 2 else np.nan
    return {
        "fs": fs,
        "trace": yf,
        "peaks": peaks,
        "rri": rri,
        "sd1": sd1,
        "sd2": sd2,
        "rmssd": float(np.sqrt(np.mean(np.diff(rri) ** 2))) if rri.size > 2 else np.nan,
        "mean_hr": float(60000 / rri.mean()) if rri.size else np.nan,
        "beat_ms": (np.arange(pre + post) - pre) / fs * 1000,
        "beat_median": np.median(beats, axis=0) if beats.size else np.array([]),
        "beats": beats[:: max(1, len(beats) // 40)] if beats.size else np.empty((0, pre + post)),
    }
