"""DuckDB persistence. One database file per profile.

An import fills a fresh staging file and swaps it over the live one with an atomic
rename, so a failed or repeated import never leaves a half-written dataset.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import threading
import uuid
from contextlib import contextmanager, suppress
from pathlib import Path
from typing import Literal

import duckdb
import numpy as np
import pyarrow as pa

from biomarx.core.analysis.derived import Derived
from biomarx.core.analysis.grids import Grids, SleepSegments
from biomarx.core.analysis.sleep import Nights
from biomarx.core.domain import Dataset, SleepCode, Timeline
from biomarx.core.metrics import DAILY_KEYS
from biomarx.core.ports import EcgRecording, Series

SCHEMA = """
CREATE TABLE records_raw (type VARCHAR, source VARCHAR, unit VARCHAR, start_ts TIMESTAMP, end_ts TIMESTAMP, value VARCHAR, value_num DOUBLE);
CREATE TABLE workouts (activity VARCHAR, duration_min DOUBLE, source VARCHAR, start_ts TIMESTAMP, end_ts TIMESTAMP);
CREATE TABLE ecg (id VARCHAR PRIMARY KEY, recorded_at TIMESTAMP, classification VARCHAR, sample_rate DOUBLE, device VARCHAR, samples BLOB);
CREATE TABLE grids (name VARCHAR PRIMARY KEY, rows BIGINT, cols BIGINT, dtype VARCHAR, data BLOB);
CREATE TABLE meta (key VARCHAR PRIMARY KEY, value VARCHAR);
"""

GRID_FIELDS = {"hr1": np.float32, "worn": np.bool_, "steps10": np.float32, "sleep": np.int8}

STAGE_CASE = f"""
CASE replace(replace(value, 'HKCategoryValueSleepAnalysis', ''), 'AsleepUnspecified', 'AsleepCore')
  WHEN 'Awake' THEN {SleepCode.AWAKE.value}
  WHEN 'AsleepCore' THEN {SleepCode.CORE.value}
  WHEN 'Asleep' THEN {SleepCode.CORE.value}
  WHEN 'AsleepREM' THEN {SleepCode.REM.value}
  WHEN 'AsleepDeep' THEN {SleepCode.DEEP.value}
END
"""


def _arr(rows, i: int, dtype) -> np.ndarray:
    return np.array([r[i] for r in rows], dtype=dtype)


class DuckRecordReader:
    def __init__(self, con: duckdb.DuckDBPyConnection) -> None:
        self.con = con

    def _q(self, sql: str, *params) -> list[tuple]:
        return self.con.execute(sql, list(params)).fetchall()

    def _series(self, sql: str, *params) -> Series:
        res = self.con.execute(sql, list(params)).fetchnumpy()
        cols = list(res.values())
        return np.asarray(cols[0], dtype=np.int64), np.asarray(cols[1], dtype=np.float64)

    def heart_rate_span(self) -> tuple[dt.date, dt.date] | None:
        row = self._q("SELECT min(start_ts)::DATE, max(start_ts)::DATE FROM records WHERE type = 'HeartRate'")[0]
        return None if row[0] is None else (row[0], row[1])

    def _best_by_day(self, record_type: str) -> str:
        return f"""
        WITH x AS (SELECT source, start_ts, value_num AS v, start_ts::DATE AS d FROM records
                   WHERE type = '{record_type}' AND value_num IS NOT NULL),
        best AS (SELECT d, source FROM (
                   SELECT d, source, row_number() OVER (PARTITION BY d ORDER BY count(*) DESC, source DESC) AS r
                   FROM x GROUP BY d, source) WHERE r = 1)
        SELECT x.* FROM x JOIN best USING (d, source)
        """

    def heart_rate_minutes(self, origin: dt.date) -> Series:
        return self._series(
            f"SELECT datediff('minute', ?::TIMESTAMP, start_ts) AS m, avg(v) FROM ({self._best_by_day('HeartRate')}) GROUP BY m",
            origin,
        )

    def steps_bins(self, origin: dt.date) -> Series:
        return self._series(
            """SELECT b, max(s) FROM (
                 SELECT source, datediff('minute', ?::TIMESTAMP, start_ts) // 10 AS b, sum(value_num) AS s
                 FROM records WHERE type = 'StepCount' GROUP BY source, b) GROUP BY b""",
            origin,
        )

    def sleep_segments(self, origin: dt.date) -> SleepSegments:
        res = self.con.execute(
            f"""
            WITH s AS (SELECT source, start_ts, end_ts, {STAGE_CASE} AS stage,
                              (start_ts - INTERVAL 12 HOUR)::DATE AS night,
                              datediff('second', start_ts, end_ts) / 60.0 AS mins
                       FROM records WHERE type = 'SleepAnalysis'),
            s2 AS (SELECT * FROM s WHERE stage IS NOT NULL),
            best AS (SELECT night, source FROM (
                       SELECT night, source, row_number() OVER (PARTITION BY night ORDER BY sum(mins) DESC, source DESC) AS r
                       FROM s2 GROUP BY night, source) WHERE r = 1)
            SELECT datediff('day', ?::DATE, night) AS n, stage,
                   datediff('minute', ?::TIMESTAMP, start_ts) AS a, datediff('minute', ?::TIMESTAMP, end_ts) AS b
            FROM s2 JOIN best USING (night, source)
            """,
            [origin, origin, origin],
        ).fetchnumpy()
        return SleepSegments(
            night=np.asarray(res["n"], dtype=np.int64),
            stage=np.asarray(res["stage"], dtype=np.int8),
            start=np.asarray(res["a"], dtype=np.int64),
            end=np.asarray(res["b"], dtype=np.int64),
        )

    def samples(self, record_type: str, origin: dt.date) -> Series:
        return self._series(
            "SELECT datediff('minute', ?::TIMESTAMP, start_ts), value_num FROM records WHERE type = ? AND value_num IS NOT NULL",
            origin,
            record_type,
        )

    def daily_best_source(self, record_type: str, agg: Literal["mean", "sum"], origin: dt.date) -> Series:
        fn = {"mean": "avg", "sum": "sum"}[agg]
        return self._series(
            f"SELECT datediff('day', ?::DATE, d) AS i, {fn}(v) FROM ({self._best_by_day(record_type)}) GROUP BY i",
            origin,
        )

    def daily_median(self, record_type: str, origin: dt.date) -> Series:
        return self._series(
            """SELECT datediff('day', ?::DATE, start_ts::DATE) AS i, median(value_num) FROM records
               WHERE type = ? AND value_num IS NOT NULL GROUP BY i""",
            origin,
            record_type,
        )


class DuckSink:
    def __init__(self, con: duckdb.DuckDBPyConnection) -> None:
        self.con = con
        self.exported_at: dt.datetime | None = None

    def add_records(self, batch: dict[str, list]) -> None:
        self.con.register("batch", pa.table(batch))
        self.con.execute(
            """INSERT INTO records_raw SELECT type, source, unit, try_cast(start AS TIMESTAMP), try_cast("end" AS TIMESTAMP),
               value, try_cast(value AS DOUBLE) FROM batch"""
        )
        self.con.unregister("batch")

    def add_workouts(self, batch: dict[str, list]) -> None:
        self.con.register("wbatch", pa.table(batch))
        self.con.execute(
            """INSERT INTO workouts SELECT activity, duration_min, source, try_cast(start AS TIMESTAMP), try_cast("end" AS TIMESTAMP)
               FROM wbatch"""
        )
        self.con.unregister("wbatch")

    def add_ecg(self, ecg: EcgRecording) -> None:
        self.con.execute(
            "INSERT OR REPLACE INTO ecg VALUES (?, ?, ?, ?, ?, ?)",
            [ecg.id, ecg.recorded_at, ecg.classification, ecg.sample_rate, ecg.device, ecg.microvolts.tobytes()],
        )

    def set_export_date(self, exported_at: dt.datetime | None) -> None:
        self.exported_at = exported_at


class DuckStaging:
    def __init__(self, store: DuckStore, path: Path) -> None:
        self.store, self.path = store, path
        self.con = duckdb.connect(str(path))
        self.con.execute(SCHEMA)
        self.sink = DuckSink(self.con)
        self.reader = DuckRecordReader(self.con)
        self._sorted = False

    def finish_records(self) -> None:
        """Cluster raw records by type and time so per-type scans prune whole row groups."""
        if self._sorted:
            return
        self.con.execute("CREATE TABLE records AS SELECT * FROM records_raw ORDER BY type, start_ts; DROP TABLE records_raw;")
        self._sorted = True

    def write_derived(self, derived: Derived) -> None:
        g, n, tl = derived.grids, derived.nights, derived.grids.timeline
        for name in GRID_FIELDS:
            a = np.ascontiguousarray(getattr(g, name))
            rows, cols = a.shape if a.ndim == 2 else (tl.rows, a.size // tl.rows)
            self.con.execute("INSERT INTO grids VALUES (?, ?, ?, ?, ?)", [name, rows, cols, a.dtype.str, a.tobytes()])

        nights = {"night": n.night, "i0": n.i0, "i1": n.i1, **{k: np.asarray(v, dtype=np.float64) for k, v in n.cols.items()}}
        self.con.register("nights_df", pa.table(nights))
        self.con.execute("CREATE TABLE nights AS SELECT * FROM nights_df ORDER BY night")
        self.con.unregister("nights_df")

        days = np.array([tl.start + dt.timedelta(days=i) for i in range(tl.days)], dtype="datetime64[D]")
        daily = {"day": pa.array(days), **{k: pa.array(derived.daily[k], from_pandas=True) for k in DAILY_KEYS}}
        self.con.register("daily_df", pa.table(daily))
        self.con.execute("CREATE TABLE daily AS SELECT * FROM daily_df ORDER BY day")
        self.con.unregister("daily_df")

        records = self.con.execute("SELECT count(*) FROM records").fetchone()[0]
        sources = [r[0] for r in self.con.execute("SELECT DISTINCT source FROM records ORDER BY 1").fetchall()]
        meta = {
            "start": tl.start.isoformat(),
            "days": str(tl.days),
            "records": str(records),
            "nights": str(len(n)),
            "sources": json.dumps(sources),
            "exported_at": self.sink.exported_at.isoformat() if self.sink.exported_at else "",
            "imported_at": dt.datetime.now(dt.UTC).isoformat(),
            "version": uuid.uuid4().hex[:12],
        }
        self.con.executemany("INSERT INTO meta VALUES (?, ?)", list(meta.items()))

    def publish(self) -> None:
        self.con.execute("CHECKPOINT")
        self.con.close()
        self.store._swap(self.path)

    def discard(self) -> None:
        with suppress(duckdb.Error):
            self.con.close()
        for p in (self.path, self.path.with_suffix(self.path.suffix + ".wal")):
            p.unlink(missing_ok=True)


class DuckStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._con: duckdb.DuckDBPyConnection | None = None
        self._cache: tuple[str, Derived] | None = None
        self._open()

    def _open(self) -> None:
        self._con = duckdb.connect(str(self.path), read_only=False) if self.path.exists() else None

    def _swap(self, staged: Path) -> None:
        with self._lock:
            if self._con is not None:
                self._con.close()
            os.replace(staged, self.path)
            Path(str(self.path) + ".wal").unlink(missing_ok=True)
            self._cache = None
            self._open()

    @contextmanager
    def staging(self):
        path = self.path.with_name(self.path.name + ".staging")
        for p in (path, Path(str(path) + ".wal")):
            p.unlink(missing_ok=True)
        stage = DuckStaging(self, path)
        try:
            yield stage
        except BaseException:
            stage.discard()
            raise

    def _meta(self) -> dict[str, str] | None:
        if self._con is None:
            return None
        try:
            return dict(self._con.execute("SELECT key, value FROM meta").fetchall())
        except duckdb.CatalogException:
            return None

    def dataset(self) -> Dataset | None:
        with self._lock:
            m = self._meta()
        if not m:
            return None
        return Dataset(
            timeline=Timeline(dt.date.fromisoformat(m["start"]), int(m["days"])),
            records=int(m["records"]),
            nights=int(m["nights"]),
            sources=tuple(json.loads(m["sources"])),
            exported_at=dt.datetime.fromisoformat(m["exported_at"]) if m["exported_at"] else None,
            imported_at=dt.datetime.fromisoformat(m["imported_at"]),
            version=m["version"],
        )

    def derived(self) -> Derived | None:
        ds = self.dataset()
        if ds is None:
            return None
        with self._lock:
            if self._cache and self._cache[0] == ds.version:
                return self._cache[1]
            assert self._con is not None
            con = self._con
            arrays = {}
            for name, rows, cols, dtype, data in con.execute("SELECT * FROM grids").fetchall():
                a = np.frombuffer(data, dtype=np.dtype(dtype)).copy()
                arrays[name] = a.reshape(rows, cols) if name == "steps10" else a
            grids = Grids(ds.timeline, arrays["hr1"], arrays["worn"].astype(bool), arrays["steps10"], arrays["sleep"])
            nr = con.execute("SELECT * FROM nights ORDER BY night").fetchnumpy()
            nights = Nights(
                np.asarray(nr.pop("night"), dtype=np.int64),
                np.asarray(nr.pop("i0"), dtype=np.int64),
                np.asarray(nr.pop("i1"), dtype=np.int64),
                {k: _float(v) for k, v in nr.items()},
            )
            dr = con.execute("SELECT * FROM daily ORDER BY day").fetchnumpy()
            daily = {k: _float(dr[k]) for k in DAILY_KEYS}
            derived = Derived(grids, nights, daily)
            self._cache = (ds.version, derived)
            return derived

    def ecg_recordings(self) -> list[EcgRecording]:
        with self._lock:
            if self._con is None or self._meta() is None:
                return []
            rows = self._con.execute("SELECT * FROM ecg ORDER BY recorded_at").fetchall()
        return [EcgRecording(r[0], r[1], r[2], r[3], r[4], np.frombuffer(r[5], dtype=np.float32).copy()) for r in rows]


def _float(v) -> np.ndarray:
    """DuckDB returns masked arrays for nullable columns; NaN is the in-memory missing value."""
    if isinstance(v, np.ma.MaskedArray):
        return v.astype(np.float64).filled(np.nan)
    return np.asarray(v, dtype=np.float64)
