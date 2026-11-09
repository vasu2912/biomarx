"""Compare Biomarx's derived dataset against the reference analysis in health_viz/viz.py.

Runs the reference's data stage (everything before its figures) on its own 365-day
window, then checks headline numbers and per-day series against the Biomarx DuckDB.

    uv run --with pandas --with matplotlib python scripts/parity.py [path/to/viz.py]

Exit code 1 if any check fails its tolerance.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

from biomarx.config import Settings
from biomarx.container import build
from biomarx.impl.jobs import InlineJobRunner

VIZ = Path(sys.argv[1] if len(sys.argv) > 1 else "~/Downloads/health_viz/viz.py").expanduser()


def reference() -> dict:
    src = VIZ.read_text().split("# ============================================================================ FIGURES")[0]
    ns: dict = {"__file__": str(VIZ), "__name__": "viz_reference"}
    exec(compile(src, str(VIZ), "exec"), ns)
    return ns


def main() -> int:
    ref = reference()
    pd = ref["pd"]
    c = build(Settings.from_env(), InlineJobRunner())
    ins = c.insights
    w = ins.window(ref["START"].date(), ref["END"].date())
    N, D = ref["N"], ref["D"]

    ours_n = ins.nights(w)
    ours_d = ins.daily(w)
    summ = ins.summary(w)
    chrono = ins.chronotype(w)
    nights_idx = pd.DatetimeIndex([pd.Timestamp(w.day(int(i))) for i in ours_n.night])

    free = N.index.dayofweek.isin([4, 5])
    msf, msw = N.mid_h[free].median(), N.mid_h[~free].median()

    checks: list[tuple[str, float, float, float]] = [
        ("nights in window", len(N), len(ours_n), 2),
        ("median total sleep h", N.tst.median(), summ["tst"], 0.05),
        ("median onset h", N.onset_h.median(), summ["onset_h"], 0.05),
        ("median wake h", N.offset_h.median(), summ["offset_h"], 0.05),
        ("mean SRI", np.nanmean(ref["sri"]), summ["sri"], 0.5),
        ("median HR dip %", N.dip.median(), summ["dip"], 0.2),
        ("median night HRV ms", N.hrv.median(), summ["hrv"], 0.5),
        ("median RHR next morning", N.rhr_next.median(), summ["rhr_next"], 0.5),
        ("median SpO2 %", N.spo2.median(), summ["spo2"], 0.1),
        ("MSF h", msf, chrono["msf"], 0.05),
        ("MSW h", msw, chrono["msw"], 0.05),
        ("social jet lag min", abs(msf - msw) * 60, summ["social_jetlag_min"], 3),
        ("valid days", float(ref["valid_day"].sum()), summ["valid_days"], 2),
    ]

    # per-night and per-day series on the shared interior (edges differ by window context)
    joined = N.join(pd.DataFrame({k: ours_n.cols[k] for k in ("tst", "onset_h", "night_hr", "hrv")}, index=nights_idx), rsuffix="_o", how="inner")
    for col, tol in (("tst", 0.02), ("onset_h", 0.02), ("night_hr", 0.5), ("hrv", 0.5)):
        diff = (joined[col] - joined[f"{col}_o"]).abs()
        checks.append((f"night {col}: share within {tol}", 1.0, float((diff.dropna() <= tol).mean()), 0.03))

    interior = slice(10, w.hi - w.lo - 10)
    for ref_col, ours_col, tol in (("sri", "sri", 0.5), ("hr_mesor", "hr_mesor", 0.2), ("hr_amp", "hr_amp", 0.2), ("steps", "steps", 1)):
        a = D[ref_col].to_numpy()[interior]
        b = ours_d[ours_col][interior]
        m = np.isfinite(a) & np.isfinite(b)
        share = float((np.abs(a[m] - b[m]) <= tol).mean()) if m.any() else 0.0
        both = float((np.isfinite(a) == np.isfinite(b)).mean())
        checks.append((f"daily {ours_col}: share within {tol}", 1.0, share, 0.03))
        checks.append((f"daily {ours_col}: same missingness", 1.0, both, 0.03))

    for ref_df, ref_col, ours_col in ((ref["NPC"], "IS", "is_steps"), (ref["NPC"], "RA", "ra_steps"), (ref["NPCH"], "IS", "is_hr")):
        a = ref_df[ref_col].to_numpy()[interior]
        b = ours_d[ours_col][interior]
        m = np.isfinite(a) & np.isfinite(b)
        checks.append((f"daily {ours_col}: share within 0.01", 1.0, float((np.abs(a[m] - b[m]) <= 0.01).mean()) if m.any() else 0.0, 0.03))

    failed = 0
    width = max(len(c[0]) for c in checks)
    print(f"{'check':<{width}}  {'reference':>10}  {'biomarx':>10}  verdict")
    for name, a, b, tol in checks:
        ok = b is not None and np.isfinite(b) and abs(a - b) <= tol
        failed += not ok
        print(f"{name:<{width}}  {a:>10.3f}  {(b if b is not None else float('nan')):>10.3f}  {'VERIFIED' if ok else 'NOT VERIFIED'}")
    print(f"\n{len(checks) - failed}/{len(checks)} checks within tolerance")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
