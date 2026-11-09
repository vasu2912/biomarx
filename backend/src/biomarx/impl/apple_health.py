"""Streams an Apple Health export without extracting it to disk.

`export.xml` writes one element per line, so a line scanner with an attribute regex
is several times faster than a SAX parser and keeps memory flat.
"""

from __future__ import annotations

import datetime as dt
import html
import io
import re
import zipfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import IO

import numpy as np

from biomarx.core.ports import EcgRecording, ProgressFn, RecordSink

BATCH = 250_000
ATTR = re.compile(r'(\w+)="([^"]*)"')
TYPE_PREFIX = re.compile(r"^HK(?:Quantity|Category|Data)TypeIdentifier")
ECG_DIR = "electrocardiograms/"
ECG_KEEP = ("Recorded Date", "Classification", "Sample Rate", "Device")


class ExportFormatError(ValueError):
    pass


class AppleHealthReader:
    def read(self, path: Path, sink: RecordSink, progress: ProgressFn) -> int:
        with _open_export(path) as (xml, total, ecgs):
            n = _scan_xml(xml, total, sink, progress)
            for ecg in ecgs():
                sink.add_ecg(ecg)
        return n


@contextmanager
def _open_export(path: Path):
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
            xml_name = next((n for n in names if n.endswith("/export.xml") or n == "export.xml"), None)
            if xml_name is None:
                raise ExportFormatError("This zip has no export.xml. Export it again from the Health app.")
            total = zf.getinfo(xml_name).file_size
            ecg_names = sorted(n for n in names if ECG_DIR in n and n.endswith(".csv"))

            def ecgs() -> Iterator[EcgRecording]:
                for name in ecg_names:
                    with zf.open(name) as f:
                        rec = parse_ecg(Path(name).stem, io.TextIOWrapper(f, encoding="utf-8"))
                    if rec:
                        yield rec

            with zf.open(xml_name) as raw:
                yield io.TextIOWrapper(raw, encoding="utf-8"), total, ecgs
        return
    if path.suffix == ".xml":
        ecg_dir = path.parent / "electrocardiograms"

        def ecgs() -> Iterator[EcgRecording]:
            for p in sorted(ecg_dir.glob("ecg_*.csv")) if ecg_dir.is_dir() else []:
                with p.open(encoding="utf-8") as f:
                    rec = parse_ecg(p.stem, f)
                if rec:
                    yield rec

        with path.open(encoding="utf-8") as f:
            yield f, path.stat().st_size, ecgs
        return
    raise ExportFormatError("Upload the export.zip from the Health app, or its export.xml.")


def _scan_xml(xml: IO[str], total: int, sink: RecordSink, progress: ProgressFn) -> int:
    cols = {k: [] for k in ("type", "source", "unit", "start", "end", "value")}
    wcols = {k: [] for k in ("activity", "duration_min", "source", "start", "end")}
    unescape = _Unescaper()
    n, read = 0, 0
    tick = total // 200 or 1
    next_tick = tick
    for line in xml:
        read += len(line)
        s = line.lstrip()
        if s.startswith("<Record "):
            d = dict(ATTR.findall(s))
            cols["type"].append(TYPE_PREFIX.sub("", d.get("type", "")))
            cols["source"].append(unescape(d.get("sourceName", "")))
            cols["unit"].append(d.get("unit"))
            cols["start"].append(d.get("startDate", "")[:19])
            cols["end"].append(d.get("endDate", "")[:19])
            cols["value"].append(unescape(d["value"]) if "value" in d else None)
            n += 1
            if n % BATCH == 0:
                sink.add_records(cols)
                cols = {k: [] for k in cols}
        elif s.startswith("<Workout "):
            d = dict(ATTR.findall(s))
            wcols["activity"].append(d.get("workoutActivityType", "").removeprefix("HKWorkoutActivityType"))
            wcols["duration_min"].append(float(d["duration"]) if d.get("duration") else None)
            wcols["source"].append(unescape(d.get("sourceName", "")))
            wcols["start"].append(d.get("startDate", "")[:19])
            wcols["end"].append(d.get("endDate", "")[:19])
        elif s.startswith("<ExportDate "):
            v = ATTR.findall(s)
            sink.set_export_date(_parse_ts(v[0][1]) if v else None)
        if read >= next_tick:
            next_tick += tick
            progress(min(read / total, 1.0), f"{n:,} records read", n)
    if cols["type"]:
        sink.add_records(cols)
    if wcols["activity"]:
        sink.add_workouts(wcols)
    if n == 0:
        raise ExportFormatError("No health records found in this export.")
    progress(1.0, f"{n:,} records read", n)
    return n


def parse_ecg(stem: str, f: IO[str]) -> EcgRecording | None:
    """Keep only clinical metadata and samples. Name and date of birth in the header are dropped."""
    meta: dict[str, str] = {}
    values: list[float] = []
    for line in f:
        head, _, rest = line.rstrip("\n").partition(",")
        try:
            values.append(float(head))
        except ValueError:
            if head in ECG_KEEP:
                meta[head] = rest.strip().strip('"')
    if len(values) < 512 or "Recorded Date" not in meta:
        return None
    rate = float(meta.get("Sample Rate", "512 hertz").split()[0])
    return EcgRecording(
        id=stem.removeprefix("ecg_"),
        recorded_at=_parse_ts(meta["Recorded Date"]),
        classification=meta.get("Classification", ""),
        sample_rate=rate,
        device=meta.get("Device", ""),
        microvolts=np.asarray(values, dtype=np.float32),
    )


def _parse_ts(s: str) -> dt.datetime:
    return dt.datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")


class _Unescaper:
    """html.unescape with a cache: a handful of source names repeat millions of times."""

    def __init__(self) -> None:
        self._cache: dict[str, str] = {}

    def __call__(self, s: str) -> str:
        if "&" not in s:
            return s
        out = self._cache.get(s)
        if out is None:
            out = self._cache[s] = html.unescape(s)
        return out
