"""DuckDB persistence. One database file per profile.

An import fills a fresh staging file and swaps it over the live one with an atomic
rename, so a failed or repeated import never leaves a half-written dataset. A re-derive
uses the same swap, starting from a copy of the live file so its records carry over.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import shutil
import threading
import uuid
from contextlib import contextmanager, suppress
from pathlib import Path
from typing import Literal

import duckdb
import numpy as np
import pyarrow as pa

from biomarx.core.analysis.derived import Derived
from biomarx.core.analysis.fitness import Workouts
from biomarx.core.analysis.grids import Grids, SleepSegments
from biomarx.core.analysis.sleep import Nights
from biomarx.core.domain import Dataset, Sex, SleepCode, Timeline
from biomarx.core.metrics import DAILY_KEYS
from biomarx.core.ports import EcgRecording, Series
from biomarx.core.services.derivation import DERIVATION_VERSION

SCHEMA = """
CREATE TABLE records_raw (type VARCHAR, source VARCHAR, unit VARCHAR, start_ts TIMESTAMP, end_ts TIMESTAMP, value VARCHAR, value_num DOUBLE);
CREATE TABLE workouts (activity VARCHAR, duration_min DOUBLE, source VARCHAR, start_ts TIMESTAMP, end_ts TIMESTAMP);
CREATE TABLE ecg (id VARCHAR PRIMARY KEY, recorded_at TIMESTAMP, classification VARCHAR, sample_rate DOUBLE, device VARCHAR, samples BLOB);
CREATE TABLE meta (key VARCHAR PRIMARY KEY, value VARCHAR);
"""
DERIVED_SCHEMA = "CREATE TABLE grids (name VARCHAR PRIMARY KEY, rows BIGINT, cols BIGINT, dtype VARCHAR, data BLOB);"

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

    def intervals(self, record_type: str, origin: dt.date) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Start minute index, duration in minutes and value of every sample of one type."""
        r = self.con.execute(
            """SELECT datediff('minute', ?::TIMESTAMP, start_ts) AS m, datediff('second', start_ts, end_ts) / 60.0 AS d, value_num AS v
               FROM records WHERE type = ? AND value_num IS NOT NULL""",
            [origin, record_type],
        ).fetchnumpy()
        return np.asarray(r["m"], dtype=np.int64), _float(r["d"]), _float(r["v"])

    def workouts(self, origin: dt.date) -> Workouts:
        r = self.con.execute(
            """SELECT activity, datediff('minute', ?::TIMESTAMP, start_ts) AS a, datediff('minute', ?::TIMESTAMP, end_ts) AS b
               FROM workouts WHERE start_ts IS NOT NULL AND end_ts IS NOT NULL ORDER BY start_ts""",
            [origin, origin],
        ).fetchnumpy()
        return Workouts(np.asarray(r["activity"], dtype=object), np.asarray(r["a"], dtype=np.int64), np.asarray(r["b"], dtype=np.int64))

    def heart_rate_minutes_of_sources(self, record_type: str, origin: dt.date) -> np.ndarray:
        """Minute indices with a heart-rate sample from a source that has logged `record_type`: when that device was on the wrist."""
        r = self.con.execute(
            """SELECT DISTINCT datediff('minute', ?::TIMESTAMP, start_ts) AS m FROM records
               WHERE type = 'HeartRate' AND source IN (SELECT DISTINCT source FROM records WHERE type = ?)""",
            [origin, record_type],
        ).fetchnumpy()
        return np.asarray(r["m"], dtype=np.int64)


class DuckSink:
    def __init__(self, con: duckdb.DuckDBPyConnection, meta: dict[str, str]) -> None:
        self.con = con
        self.meta = meta

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
        self.meta["exported_at"] = exported_at.isoformat() if exported_at else ""

    def set_profile(self, birth_date: dt.date | None, sex: Sex) -> None:
        self.meta.update(birth_date=birth_date.isoformat() if birth_date else "", sex=sex)


class DuckStaging:
    def __init__(self, store: DuckStore, path: Path, from_live: bool = False) -> None:
        """`from_live` keeps the copied file's records, workouts, ecg and meta and rebuilds only the derived tables."""
        self.store, self.path = store, path
        self.con = duckdb.connect(str(path))
        if from_live:
            self.con.execute("DROP TABLE IF EXISTS grids; DROP TABLE IF EXISTS nights; DROP TABLE IF EXISTS daily;")
            self.con.execute(DERIVED_SCHEMA)
        else:
            self.con.execute(SCHEMA + DERIVED_SCHEMA)
        now = dt.datetime.now(dt.UTC).isoformat()
        self.sink = DuckSink(self.con, {} if from_live else {"exported_at": "", "imported_at": now})
        self.reader = DuckRecordReader(self.con)
        self._sorted = from_live

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
            **self.sink.meta,
            "start": tl.start.isoformat(),
            "days": str(tl.days),
            "records": str(records),
            "nights": str(len(n)),
            "sources": json.dumps(sources),
            "version": uuid.uuid4().hex[:12],
            "derivation_version": str(DERIVATION_VERSION),
        }
        self.con.executemany("INSERT OR REPLACE INTO meta VALUES (?, ?)", list(meta.items()))

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
    def staging(self, from_live: bool = False):
        path = self.path.with_name(self.path.name + ".staging")
        for p in (path, Path(str(path) + ".wal")):
            p.unlink(missing_ok=True)
        if from_live:
            with self._lock:
                assert self._con is not None
                self._con.execute("CHECKPOINT")
                shutil.copyfile(self.path, path)
        stage = DuckStaging(self, path, from_live)
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

    def needs_rederive(self) -> bool:
        with self._lock:
            m = self._meta()
            if not m:
                return False
            assert self._con is not None
            cols = {r[0] for r in self._con.execute("SELECT column_name FROM duckdb_columns() WHERE table_name = 'daily'").fetchall()}
        return int(m.get("derivation_version", 0)) < DERIVATION_VERSION or not cols.issuperset(DAILY_KEYS)

    @contextmanager
    def records(self):
        """A reader over the live database's records, holding the connection for the duration."""
        with self._lock:
            assert self._con is not None
            yield DuckRecordReader(self._con)

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
            birth_date=dt.date.fromisoformat(m["birth_date"]) if m.get("birth_date") else None,
            sex=m.get("sex", "unknown"),  # type: ignore[arg-type]
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
            # A key added since this database was derived reads as missing until the re-derive lands.
            daily = {k: _float(dr[k]) if k in dr else np.full(ds.timeline.days, np.nan) for k in DAILY_KEYS}
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
